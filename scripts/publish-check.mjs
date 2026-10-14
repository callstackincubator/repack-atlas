#!/usr/bin/env node
/**
 * publish-check — CI guard for the publish manifest (docs/decisions/npm-publish.md).
 *
 * Usage:
 *   node scripts/publish-check.mjs
 *
 * It answers one question: if a human ran `pnpm publish` right now, would the
 * registry get an honest package? Entry points are verified against the REAL
 * tarball `pnpm pack` produces (`tar tzf`), never against a prediction from the
 * `files` field — predicting npm's packing rules is how a package ships without
 * the thing its `main` points at. If the tarball cannot be produced the script
 * exits 2 ("could not answer") rather than guess; there is deliberately no flag
 * to skip the probe, because a skipped probe can only ever report a false OK.
 *
 * Workflow rules mirror the Re.Pack release playbook
 * (callstack/repack CONTRIBUTING.md "npm trusted publishing"): a workflow that
 * publishes must hold an OIDC `id-token`, and must not carry a long-lived
 * `NPM_TOKEN`/`NODE_AUTH_TOKEN` secret.
 *
 * Output: one `<rule>: <detail>` line per violation.
 * Exit codes: 0 clean, 1 violations found, 2 could not answer (no pack, no git).
 * Zero dependencies; the pure rules are exported so tests can import them.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The registry the package must publish to. */
const NPM_REGISTRY = 'https://registry.npmjs.org/';

/** Fields whose absence breaks install, provenance or the registry itself. */
const REQUIRED_FIELDS = [
  'name',
  'version',
  'description',
  'license',
  'engines',
  'bin',
];

/**
 * @typedef {{ rule: string, detail: string }} Violation
 * @typedef {{ packedFiles: string[], repositoryUrl?: string }} ManifestContext
 * @typedef {{ path: string, text: string }} WorkflowSource
 */

/** `./dist/cli.js`, `dist/cli.js` and `./dist/../dist/cli.js` → `dist/cli.js`. */
function normalizeTarget(target) {
  if (typeof target !== 'string' || !target.startsWith('./')) return null;
  const cleaned = target.replace(/^\.\//, '');
  return cleaned === '' ? null : posix.normalize(cleaned);
}

/**
 * Flatten an `exports` map into `{ entry, target }` pairs, walking every
 * condition (`types`, `default`, `node`, …) so no declared path escapes.
 */
function exportTargets(exports, prefix = '') {
  /** @type {{ entry: string, target: string }[]} */
  const out = [];
  if (typeof exports === 'string') {
    out.push({ entry: prefix || '.', target: exports });
  } else if (Array.isArray(exports)) {
    for (const value of exports) out.push(...exportTargets(value, prefix));
  } else if (exports !== null && typeof exports === 'object') {
    for (const [key, value] of Object.entries(exports)) {
      // A condition key never starts with '.', a subpath always does.
      if (key.startsWith('.')) {
        out.push(...exportTargets(value, key));
      } else {
        out.push(...exportTargets(value, prefix));
      }
    }
  }
  return out;
}

/** `owner/repo` from any git url shape, or null when it is not a github url. */
function githubSlug(url) {
  if (typeof url !== 'string') return null;
  const match = url
    .trim()
    .match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/i);
  return match ? match[1] : null;
}

/** Every declared entry point, as `{ name, target }`. */
function declaredEntryPoints(manifest) {
  /** @type {{ name: string, target: string }[]} */
  const declared = [];
  for (const field of ['main', 'module', 'types', 'typings']) {
    const value = manifest[field];
    if (typeof value === 'string') declared.push({ name: field, target: value });
  }
  const bin = manifest.bin;
  if (typeof bin === 'string') {
    declared.push({ name: 'bin', target: bin });
  } else if (bin !== null && typeof bin === 'object') {
    for (const [name, target] of Object.entries(bin)) {
      if (typeof target === 'string') declared.push({ name: `bin:${name}`, target });
    }
  }
  for (const { entry, target } of exportTargets(manifest.exports)) {
    declared.push({ name: `exports[${JSON.stringify(entry)}]`, target });
  }
  return declared;
}

/**
 * Relative README links whose target is not in the tarball. The published README
 * renders on npmjs.com with no repository behind it, so `docs/foo.md` is a 404
 * there even though it resolves fine on GitHub.
 *
 * @param {string} readme @param {Set<string>} packed @returns {Violation[]}
 */
function readmeDeadLinks(readme, packed) {
  /** @type {Violation[]} */
  const out = [];
  for (const match of readme.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1].split('#')[0].split('?')[0];
    // Skip anchors, absolute paths and any url with a scheme (http:, mailto:).
    if (
      target === '' ||
      target.startsWith('/') ||
      /^[a-z][a-z0-9+.-]*:/i.test(target)
    ) {
      continue;
    }
    const normalized = posix.normalize(target.replace(/^\.\/+/, ''));
    if (!packed.has(normalized)) {
      out.push({
        rule: 'dead-link',
        detail: `README links to ${target}, which is not in the tarball (npm renders the README with no repository behind it)`,
      });
    }
  }
  return out;
}

/**
 * The manifest rules. Pure: it takes the manifest and the evidence (packed file
 * list, canonical repo url) and returns violations, so tests can drive it with
 * synthetic manifests.
 *
 * @param {Record<string, unknown>} manifest
 * @param {ManifestContext} context
 * @returns {Violation[]}
 */
export function validateManifest(manifest, context) {
  /** @type {Violation[]} */
  const violations = [];
  const packed = new Set(context.packedFiles);

  for (const field of REQUIRED_FIELDS) {
    if (manifest[field] === undefined || manifest[field] === null) {
      violations.push({
        rule: 'missing-field',
        detail: `${field} is required to publish`,
      });
    }
  }

  const license = manifest.license;
  if (license !== undefined && license !== 'MIT') {
    violations.push({
      rule: 'license-not-mit',
      detail: `license is ${JSON.stringify(license)}, this project is MIT (docs/PRD.md §13)`,
    });
  }

  for (const { name, target } of declaredEntryPoints(manifest)) {
    const normalized = normalizeTarget(target);
    if (normalized === null) {
      violations.push({
        rule: 'dangling-entry',
        detail: `${name} points at ${JSON.stringify(target)}, which is not a "./" path`,
      });
    } else if (!packed.has(normalized)) {
      violations.push({
        rule: 'dangling-entry',
        detail: `${name} points at ${normalized}, which no packaged file provides`,
      });
    }
  }

  const files = manifest.files;
  const shipsDist =
    Array.isArray(files) &&
    files.some((entry) => typeof entry === 'string' && /^dist\/?$/.test(entry));
  if (!shipsDist) {
    violations.push({
      rule: 'files-missing-dist',
      detail: 'files must ship "dist", otherwise the published package has no code',
    });
  }

  const scripts = manifest.scripts;
  const prepack =
    scripts !== null && typeof scripts === 'object'
      ? /** @type {Record<string, unknown>} */ (scripts).prepack
      : undefined;
  if (typeof prepack !== 'string' || prepack === '') {
    violations.push({
      rule: 'stale-dist-guard-missing',
      detail:
        'scripts.prepack must build dist before packing: dist/ is gitignored, so a publish without a build ships whatever stale tree is left',
    });
  }

  const repository =
    manifest.repository !== null && typeof manifest.repository === 'object'
      ? /** @type {Record<string, unknown>} */ (manifest.repository).url
      : manifest.repository;
  const slug = githubSlug(
    typeof repository === 'string' ? repository : undefined
  );
  if (slug === null) {
    violations.push({
      rule: 'repository-missing',
      detail:
        'repository.url must name the git repo: npm validates it against the publishing repo for provenance',
    });
  } else if (context.repositoryUrl !== undefined) {
    const expected = githubSlug(context.repositoryUrl);
    if (expected !== null && expected !== slug) {
      violations.push({
        rule: 'repository-mismatch',
        detail: `repository.url is ${slug}, expected ${context.repositoryUrl} (provenance is bound to the publishing repo)`,
      });
    }
  }

  // A `pnpm link` run inside the repo writes `"<name>": "link:"` into
  // dependencies and an override in pnpm-workspace.yaml; the self-reference
  // then reaches the published tarball. Seen happening for real.
  const name = typeof manifest.name === 'string' ? manifest.name : '';
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = manifest[field];
    if (name !== '' && deps !== null && typeof deps === 'object' && name in deps) {
      violations.push({
        rule: 'self-dependency',
        detail: `${field} declares ${name} — the package cannot depend on itself (a stray \`pnpm link\` in this repo does exactly this)`,
      });
    }
  }

  if (typeof context.readme === 'string') {
    violations.push(...readmeDeadLinks(context.readme, packed));
  }

  const publishConfig =
    manifest.publishConfig !== null && typeof manifest.publishConfig === 'object'
      ? /** @type {Record<string, unknown>} */ (manifest.publishConfig)
      : {};
  if (
    typeof manifest.name === 'string' &&
    manifest.name.startsWith('@') &&
    publishConfig.access !== 'public'
  ) {
    violations.push({
      rule: 'publish-access-missing',
      detail: `publishConfig.access must be "public" for the scoped name ${manifest.name}`,
    });
  }
  if (
    publishConfig.registry !== undefined &&
    publishConfig.registry !== NPM_REGISTRY
  ) {
    violations.push({
      rule: 'publish-registry-unexpected',
      detail: `publishConfig.registry is ${JSON.stringify(publishConfig.registry)}, expected ${NPM_REGISTRY}`,
    });
  }

  return violations;
}

/**
 * Does this workflow publish to a registry? The `changesets/action` shape counts
 * even though its publish command is a maintainer-chosen script: that is how a
 * long-lived token sneaks into a repo that is supposed to use OIDC.
 */
function publishes(text) {
  return (
    /(?:pnpm|npm|yarn)\s+(?:-r\s+)?(?:publish|release)\b|changeset\s+publish/.test(text) ||
    /uses:\s*changesets\/action@/.test(text)
  );
}

/**
 * The workflow rules. Re.Pack's playbook is explicit: trusted publishing, no
 * long-lived token secrets.
 *
 * @param {WorkflowSource[]} workflows
 * @returns {Violation[]}
 */
export function validateWorkflows(workflows) {
  /** @type {Violation[]} */
  const violations = [];
  for (const { path: file, text } of workflows) {
    if (!publishes(text)) continue;
    const token = text.match(/secrets\.(NPM_TOKEN|NODE_AUTH_TOKEN)\b/);
    if (token !== null) {
      violations.push({
        rule: 'publish-token-secret',
        detail: `${file} uses secrets.${token[1]} — releases use npm trusted publishing (OIDC), not long-lived tokens`,
      });
    }
    if (!/^\s*id-token:\s*write\s*$/m.test(text)) {
      violations.push({
        rule: 'publish-id-token-missing',
        detail: `${file} publishes but has no "id-token: write" permission, so it cannot get an OIDC token`,
      });
    }
  }
  return violations;
}

/**
 * @param {Violation[]} violations
 * @returns {string[]}
 */
export function formatViolations(violations) {
  return violations.map((violation) => `${violation.rule}: ${violation.detail}`);
}

/** Pack into a throwaway dir; returns { files, tarballPath } for reuse. */
function packOnce() {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-publish-check-'));
  try {
    execFileSync('pnpm', ['pack', '--pack-destination', dir], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
      maxBuffer: 64 * 1024 * 1024,
    });
    const tarball = readdirSync(dir).find((entry) => entry.endsWith('.tgz'));
    if (tarball === undefined) {
      throw new Error('pnpm pack produced no tarball');
    }
    const tarballPath = join(dir, tarball);
    const files = execFileSync('tar', ['tzf', tarballPath], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
      .split('\n')
      .filter(Boolean)
      .map((entry) => entry.replace(/^package\//, ''));
    return { files, tarballPath, dir };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

/** Read the README exactly as it was packed, or null when it is not there. */
function readPackedReadme(tarballPath) {
  try {
    return execFileSync('tar', ['-xzOf', tarballPath, 'package/README.md'], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/** @returns {string | undefined} the canonical repo url, or undefined if unknown. */
function originUrl() {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return undefined;
  }
}

/** @returns {{path: string, text: string}[]} */
function readWorkflows() {
  const dir = join(REPO_ROOT, '.github', 'workflows');
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'))
    .map((entry) => ({
      path: `.github/workflows/${entry}`,
      text: readFileSync(join(dir, entry), 'utf8'),
    }));
}

/** @param {string[]} argv @returns {number} */
export function main(argv = process.argv.slice(2)) {
  if (argv.length > 0) {
    console.error(
      `publish-check: unknown argument ${JSON.stringify(argv[0])} (this script takes none).`
    );
    return 2;
  }

  /** @type {Record<string, unknown>} */
  let manifest;
  try {
    manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')
    );
  } catch (error) {
    console.error(`publish-check: cannot read package.json: ${error.message}`);
    return 2;
  }

  let packed;
  try {
    packed = packOnce();
  } catch (error) {
    console.error(
      `publish-check: could not probe the tarball: ${error.message}\n` +
        'publish-check: refusing to guess what ships (exit 2 = could not answer).'
    );
    return 2;
  }
  const packedFiles = packed.files;
  const readmeText =
    readPackedReadme(packed.tarballPath) ??
    (existsSync(join(REPO_ROOT, 'README.md'))
      ? readFileSync(join(REPO_ROOT, 'README.md'), 'utf8')
      : undefined);
  rmSync(packed.dir, { recursive: true, force: true });

  let workflows;
  try {
    workflows = readWorkflows();
  } catch (error) {
    console.error(`publish-check: cannot read .github/workflows: ${error.message}`);
    return 2;
  }

  const violations = [
    ...validateManifest(manifest, {
      packedFiles,
      repositoryUrl: originUrl(),
      readme: readmeText,
    }),
    ...validateWorkflows(workflows),
  ];

  if (violations.length > 0) {
    for (const line of formatViolations(violations)) console.log(line);
    console.error(
      `publish-check: ${violations.length} problem(s) before publishing (docs/decisions/npm-publish.md).`
    );
    return 1;
  }

  console.log(
    `publish-check: OK - ${manifest.name}@${manifest.version}` +
      ` with ${packedFiles.length} packaged file(s), ${workflows.length} workflow(s) checked`
  );
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) process.exit(main());
