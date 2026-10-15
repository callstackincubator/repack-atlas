#!/usr/bin/env node
/**
 * publish-preflight — run every gate before `pnpm publish`, in one command.
 *
 * Usage:
 *   node scripts/publish-preflight.mjs [--keep]
 *
 * `pnpm publish` is the one step that cannot be undone: a published version can
 * never be reused. So everything a human would check by hand before it lives
 * here instead, and it is checked against the REAL artifact — the tarball
 * `pnpm pack` writes, installed into a throwaway project — not against the
 * working tree, which is not what users receive.
 *
 * Gates, in order, all required:
 *   G1 manifest      the publish-check rules over the packed tarball
 *   G2 install       a fresh project can install the tarball
 *   G3 bin           the installed binary prints the packed version
 *   G4 public API    `…/plugin` and `…/introspection` import as functions
 *   G5 behavior      doctor reproduces the finding it promises, with the right
 *                    exit code, through the installed artifact
 *   G6 provenance    the tarball is byte-identical to what we just probed
 *
 * Output: one `G<n> PASS|FAIL|SKIP <detail>` line per gate.
 * Exit codes (AGENTS.md rule 6): 0 all gates passed, 1 a gate failed — do not
 * publish, 2 could not answer (no pnpm/npm/network) — do not publish either.
 * `--keep` leaves the scratch project and the tarball in place for inspection.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  formatViolations,
  validateManifest,
  validateWorkflows,
} from './publish-check.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_NAME = '@callstack/repack-atlas';

/** The two public subpaths: breaking these is a major version (PRD §8.2). */
const PUBLIC_SUBPATHS = ['plugin', 'introspection'];

/** Reported in this order, whatever order the probes finish in. */
export const gateNames = [
  'G1 manifest',
  'G2 install',
  'G3 bin',
  'G4 public API',
  'G5 behavior',
  'G6 reproducibility',
];

/**
 * @typedef {{ gate: string, status: 'PASS'|'FAIL'|'SKIP', detail: string }} GateResult
 */

/** @returns {string} sha256 of the file. */
function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** Run a command, returning { code, stdout, stderr } without throwing. */
function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  if (result.error !== undefined) {
    return { code: null, stdout: '', stderr: String(result.error.message) };
  }
  return {
    code: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * Pack the repo into a directory of its own; returns { tarball, files, hash }.
 *
 * Each run gets its own directory on purpose: pointed at one directory twice,
 * the listing below finds the first tarball again and reports two identical
 * packs while only one pack wrote bytes.
 */
function packInto(dir) {
  mkdirSync(dir, { recursive: true });
  execFileSync('pnpm', ['pack', '--pack-destination', dir], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
    maxBuffer: 64 * 1024 * 1024,
  });
  const written = readdirSync(dir).filter((entry) => entry.endsWith('.tgz'));
  if (written.length === 0) throw new Error('pnpm pack produced no tarball');
  if (written.length > 1) {
    throw new Error(
      `pack directory ${dir} holds ${written.length} tarballs; each pack needs a clean one`
    );
  }
  const name = written[0];
  const tarball = join(dir, name);
  const files = execFileSync('tar', ['tzf', tarball], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((entry) => entry.replace(/^package\//, ''));
  return { tarball, files, hash: sha256(tarball) };
}

/**
 * G1: the manifest rules, over the real tarball. Reuses publish-check's rules
 * so the two can never disagree about what "publishable" means.
 *
 * @param {{ tarball: string, files: string[] }} packed
 * @returns {GateResult}
 */
export function gateManifest(evidence) {
  if (evidence.manifest.name !== PACKAGE_NAME) {
    return {
      gate: 'G1 manifest',
      status: 'FAIL',
      detail: `package-name-drift: manifest.name is ${JSON.stringify(
        evidence.manifest.name
      )} but this runbook publishes ${PACKAGE_NAME}`,
    };
  }
  const violations = [
    ...validateManifest(evidence.manifest, {
      packedFiles: evidence.packedFiles,
      readme: evidence.readme,
      repositoryUrl: evidence.repositoryUrl,
    }),
    ...validateWorkflows(evidence.workflows),
  ];
  return violations.length === 0
    ? {
        gate: 'G1 manifest',
        status: 'PASS',
        detail: `${evidence.packedFiles.length} packaged file(s)`,
      }
    : {
        gate: 'G1 manifest',
        status: 'FAIL',
        detail: formatViolations(violations).join(' | '),
      };
}

/**
 * Read every piece of evidence G1 needs from disk, in one place, so
 * `gateManifest` stays pure and testable like publish-check's own rules.
 *
 * @param {{ tarball: string, files: string[] }} packed
 */
export function collectEvidence(packed) {
  const workflowsDir = join(REPO_ROOT, '.github', 'workflows');
  return {
    manifest: JSON.parse(
      readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')
    ),
    packedFiles: packed.files,
    readme: packed.files.includes('README.md')
      ? execFileSync('tar', ['-xzOf', packed.tarball, 'package/README.md'], {
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024,
        })
      : undefined,
    repositoryUrl: originUrl(),
    workflows: readdirSync(workflowsDir)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map((f) => ({
        path: `.github/workflows/${f}`,
        text: readFileSync(join(workflowsDir, f), 'utf8'),
      })),
  };
}

/**
 * G3: does the binary a user actually gets run, and print the packed version?
 *
 * Pure, because the trap here is invisible from the outside: running
 * `node dist/cli.js` succeeds even when the installed bin is broken (a missing
 * shebang, a bad bin target, a non-executable file). The evidence that decides
 * it is the exit code of `node_modules/.bin/<bin>`, kept separate from the
 * `node dist/cli.js` run so the failure message can name the difference.
 *
 * @param {{ binCode: number|null, binOut: string, cliCode: number|null,
 *   cliStdout: string, version: string, binName?: string }} evidence
 * @returns {GateResult}
 */
export function gateBin(evidence) {
  const bin = evidence.binName ?? 'repack-atlas';
  const expected = `repack-atlas ${evidence.version}`;
  const binLine = (evidence.binOut || '').trim().split('\n')[0] ?? '';
  if (evidence.binCode !== 0) {
    const cliWorks = evidence.cliCode === 0;
    return {
      gate: 'G3 bin',
      status: 'FAIL',
      detail:
        `installed bin exited ${evidence.binCode}` +
        ` (${JSON.stringify(binLine)})` +
        (cliWorks
          ? ` while \`node dist/cli.js\` printed "${evidence.cliStdout.trim()}"` +
            ' — the bin itself is broken (shebang or bin target), users cannot run it'
          : ''),
    };
  }
  if (binLine !== expected) {
    return {
      gate: 'G3 bin',
      status: 'FAIL',
      detail: `expected "${expected}" from node_modules/.bin/${bin}, got ${JSON.stringify(binLine)}`,
    };
  }
  return {
    gate: 'G3 bin',
    status: 'PASS',
    detail: `${binLine} via node_modules/.bin`,
  };
}

/** @returns {string|undefined} the canonical origin url when git can answer. */
function originUrl() {
  const out = run('git', ['remote', 'get-url', 'origin'], { cwd: REPO_ROOT });
  return out.code === 0 ? out.stdout.trim() : undefined;
}

/**
 * G2-G5: install the tarball into a fresh project and drive it as a user would.
 *
 * @param {{ tarball: string, version: string }} packed
 * @param {string} probeDir
 * @returns {GateResult[]}
 */
function probeInstalledArtifact(packed, probeDir) {
  /** @type {GateResult[]} */
  const results = [];
  const installed = run('npm', ['install', packed.tarball, '--no-audit', '--no-fund'], {
    cwd: probeDir,
  });
  if (installed.code !== 0) {
    return [
      {
        gate: 'G2 install',
        status: installed.code === null ? 'SKIP' : 'FAIL',
        detail: installed.stderr.trim().split('\n').slice(-1)[0] ?? 'install failed',
      },
      { gate: 'G3 bin', status: 'SKIP', detail: 'not installed' },
      { gate: 'G4 public API', status: 'SKIP', detail: 'not installed' },
      { gate: 'G5 behavior', status: 'SKIP', detail: 'not installed' },
    ];
  }
  // Evidence, not intent: the installed manifest is what proves the install
  // landed under the expected name, so a hardcoded name cannot fake a PASS.
  let installedVersion;
  try {
    installedVersion = String(
      JSON.parse(
        readFileSync(join(probeDir, 'node_modules', ...PACKAGE_NAME.split('/'), 'package.json'), 'utf8')
      ).version
    );
  } catch {
    installedVersion = undefined;
  }
  results.push(
    installedVersion === packed.version
      ? {
          gate: 'G2 install',
          status: 'PASS',
          detail: `fresh project installed ${PACKAGE_NAME}@${installedVersion}`,
        }
      : {
          gate: 'G2 install',
          status: 'FAIL',
          detail:
            `npm install exited ${installed.code} but ${PACKAGE_NAME}@${packed.version}` +
            ` is not in node_modules (found ${JSON.stringify(installedVersion)})`,
        }
  );

  const pkgDir = join(probeDir, 'node_modules', ...PACKAGE_NAME.split('/'));
  const cli = join(pkgDir, 'dist', 'cli.js');

  // The bin the user types, resolved by npm inside the probe project. This is
  // the only way to see a broken shebang or bin target; `node dist/cli.js`
  // hides both, and is kept only as a diagnostic for the failure message.
  const installedBin = run(join(probeDir, 'node_modules', '.bin', 'repack-atlas'), ['--version'], {
    cwd: probeDir,
  });
  const version = run(process.execPath, [cli, '--version'], { cwd: probeDir });
  results.push(
    gateBin({
      binCode: installedBin.code,
      binOut: installedBin.stdout || installedBin.stderr,
      cliCode: version.code,
      cliStdout: version.stdout,
      version: packed.version,
    })
  );

  const imports = PUBLIC_SUBPATHS.map(
    (sub) =>
      `import { ${sub === 'plugin' ? 'FederationManifestPlugin' : 'IntrospectionPlugin'} } from '${PACKAGE_NAME}/${sub}';`
  ).join('\n');
  const api = run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `${imports}\nconsole.log([${PUBLIC_SUBPATHS.map((sub) =>
        sub === 'plugin' ? 'FederationManifestPlugin' : 'IntrospectionPlugin'
      ).map((n) => `typeof ${n}`).join(', ')}].join(','));`,
    ],
    { cwd: probeDir }
  );
  results.push(
    api.stdout.trim() === PUBLIC_SUBPATHS.map(() => 'function').join(',')
      ? { gate: 'G4 public API', status: 'PASS', detail: `${PUBLIC_SUBPATHS.join(', ')} -> function` }
      : {
          gate: 'G4 public API',
          status: 'FAIL',
          detail: `expected "function,function", got ${JSON.stringify(
            (api.stdout || api.stderr).trim().split('\n')[0]
          )}`,
        }
  );

  // One fixture must report the finding (exit 1), one must be clean (exit 0):
  // the doctor is the product, and it runs through the installed artifact.
  const cases = [
    { dir: 'fixture-version-drift', wantCode: 1, wantText: 'SHARED_VERSION_DRIFT' },
    { dir: 'workspace', wantCode: 0, wantText: null },
  ];
  const failures = [];
  for (const c of cases) {
    const out = run(
      process.execPath,
      [cli, 'doctor', '--workspace', join(REPO_ROOT, 'fixtures', c.dir)],
      { cwd: probeDir }
    );
    const combined = `${out.stdout}\n${out.stderr}`;
    if (out.code !== c.wantCode) {
      failures.push(`${c.dir}: exit ${out.code}, expected ${c.wantCode}`);
    } else if (c.wantText !== null && !combined.includes(c.wantText)) {
      failures.push(`${c.dir}: exit ${out.code} but no ${c.wantText} reported`);
    }
  }
  results.push(
    failures.length === 0
      ? {
          gate: 'G5 behavior',
          status: 'PASS',
          detail: 'drift fixture -> 1 + SHARED_VERSION_DRIFT; clean fixture -> 0',
        }
      : { gate: 'G5 behavior', status: 'FAIL', detail: failures.join(' | ') }
  );
  return results;
}

/** @param {string[]} argv @returns {Promise<number>} */
export async function main(argv = process.argv.slice(2)) {
  const keep = argv.includes('--keep');
  if (argv.some((a) => a !== '--keep')) {
    console.error('publish-preflight: usage: publish-preflight.mjs [--keep]');
    return 2;
  }
  for (const tool of ['pnpm', 'npm']) {
    if (run(tool, ['--version']).code !== 0) {
      console.error(`publish-preflight: ${tool} is not available — cannot answer (exit 2).`);
      return 2;
    }
  }

  const scratch = mkdtempSync(join(tmpdir(), 'atlas-preflight-'));
  try {
    let packed;
    try {
      packed = packInto(join(scratch, 'pack-a'));
    } catch (error) {
      console.error(`publish-preflight: could not pack: ${error.message}`);
      return 2;
    }
    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')
    );

    // G6 first: if two packs differ, everything below describes a moving
    // artifact and none of it means anything.
    const repacked = packInto(join(scratch, 'pack-b'));
    const reproducibility =
      repacked.hash === packed.hash
        ? {
            gate: 'G6 reproducibility',
            status: 'PASS',
            detail: `two packs identical (${packed.hash.slice(0, 12)}…)`,
          }
        : {
            gate: 'G6 reproducibility',
            status: 'FAIL',
            detail: 'two `pnpm pack` runs produced different bytes — build is not deterministic',
          };

    const probeDir = join(scratch, 'consumer');
    execFileSync('mkdir', ['-p', probeDir]);
    execFileSync('npm', ['init', '-y'], { cwd: probeDir, stdio: 'pipe' });

    const results = [
      gateManifest(collectEvidence(packed)),
      ...probeInstalledArtifact(
        { tarball: packed.tarball, version: String(manifest.version) },
        probeDir
      ),
      reproducibility,
    ];

    for (const r of results) {
      console.log(`${r.gate.padEnd(18)} ${r.status.padEnd(4)} ${r.detail}`);
    }
    const failed = results.filter((r) => r.status === 'FAIL');
    const skipped = results.filter((r) => r.status === 'SKIP');
    if (failed.length > 0 || skipped.length > 0) {
      console.error(
        `publish-preflight: DO NOT PUBLISH — ${failed.length} failed, ${skipped.length} skipped.`
      );
      return 1;
    }
    console.log(
      `publish-preflight: all gates green for ${PACKAGE_NAME}@${manifest.version} (${packed.hash.slice(0, 12)}). Ready to publish.`
    );
    if (keep) console.log(`publish-preflight: --keep, scratch tree at ${scratch}`);
    return 0;
  } finally {
    if (!keep) rmSync(scratch, { recursive: true, force: true });
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().then((code) => { process.exitCode = code; });
