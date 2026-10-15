// The spawned-bin tests must not execute the live `dist/` while another test
// file may be rebuilding it under them.
//
// `pnpm test` builds once in `pretest`, but `tests/scripts/publish-check.test.ts`
// runs `scripts/publish-check.mjs`, which calls `pnpm pack` in the repo root —
// and `prepack` runs `tsc`, rewriting `dist/` file by file. `node:test` runs
// test files concurrently, so a spawn of `repo/dist/cli.js` can link against a
// half-written tree. CI showed exactly that (PR 79, run 38625045137):
//
//   SyntaxError: The requested module '../repack-bridge/index.js' does not
//   provide an export named 'DEFAULT_MANIFEST_FILENAME'   -> exit 1
//
// where the test asserted exit 2 for a rejected `--port`. Neighbouring test
// files in the same run were green, which is the signature of a race on the
// build output rather than a behaviour bug.
//
// The publish guard must keep packing the real repo — that is the whole point
// of it. So the fix moves the *readers* onto an immutable snapshot of the same
// bytes, outside the tree `tsc` writes to. These tests pin the failure mode,
// the isolation, and the snapshot's own behaviour.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

import {
  binPath,
  buildSnapshot,
  copyMatches,
  copyTree,
  copyVerified,
  ensureBin,
  repoBinPath,
  repoRoot,
  runBin,
} from './run-bin.js';

const exec = promisify(execFile);

/** Run the built bin from an arbitrary path, capturing code and stderr. */
async function spawnBin(
  bin: string,
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof failure.code === 'number' ? failure.code : 0,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

test('a dist/ tree mid-rewrite kills a spawn of it, with the CI signature', async () => {
  // Reproduces the CI failure on demand: a tree that is complete except for one
  // rewritten module. This is what a concurrent `prepack` leaves behind for the
  // length of one file write.
  const dir = await mkdtemp(path.join(os.tmpdir(), 'atlas-midrewrite-'));
  try {
    await copyTree(path.join(repoRoot, 'dist'), path.join(dir, 'dist'));
    await writeFile(
      path.join(dir, 'dist', 'repack-bridge', 'index.js'),
      'export const placeholder = 1;\n'
    );

    const result = await spawnBin(path.join(dir, 'dist', 'cli.js'), ['--version']);

    // Link-time failure exits 1 and names the missing export: not exit 2, and
    // not the answer argv asked for. That is why the race read as a behaviour
    // regression in the `--port` assertion instead of an environment problem.
    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stderr, /does not provide an export named/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the spawned-bin tests run a snapshot, never the dist/ tsc rewrites', async () => {
  await ensureBin();

  assert.notEqual(
    binPath,
    repoBinPath,
    'spawning the repo dist/ races a concurrent prepack rebuild'
  );
  assert.ok(
    !binPath.startsWith(repoRoot + path.sep),
    `the snapshot must live outside the repository tree, got ${binPath}`
  );
  assert.ok(
    repoBinPath.startsWith(repoRoot + path.sep),
    'the publish guard still has to reach the real repo build'
  );
});

test('the snapshot bin is self-sufficient and answers argv like the real one', async () => {
  await ensureBin();

  const { version } = JSON.parse(
    await readFile(path.join(repoRoot, 'package.json'), 'utf8')
  ) as { version: string };

  // `dist/cli/version.js` reads `../../package.json`, so a copied tree only
  // answers --version when the snapshot carries the manifest too.
  const printed = await runBin('--version');
  assert.equal(printed.code, 0, printed.stderr);
  assert.equal(printed.stdout.trim(), `repack-atlas ${version}`);

  // The module graph links from the snapshot root, including the bridge the CI
  // race broke on.
  const rejected = await runBin('dev', '--dry-run', '--port', '0x50');
  assert.equal(rejected.code, 2, rejected.stderr);
  assert.match(rejected.stderr, /--port must be a TCP port number \(1-65535\)/);
});

// The copy that builds the snapshot reads the same live tree, so it needs a
// barrier of its own. Review finding R3-snapshot-copy-race (reliability,
// CRITICAL, `introduced`): moving the readers off `repo/dist/` left the copy
// itself racing `tsc` — an unchecked copy can freeze a half-rebuilt tree.

/** Write a file, creating its parents, so a test can build a tree. */
async function put(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

test('a copy that matches its source verifies clean', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'atlas-snapshot-'));
  try {
    const source = path.join(dir, 'src');
    await put(path.join(source, 'a.js'), 'export const a = 1;\n');
    await put(path.join(source, 'sub/b.js'), 'export const b = 1;\n');
    await copyVerified(source, path.join(dir, 'copy'));

    assert.deepEqual(await copyMatches(source, path.join(dir, 'copy')), []);
    assert.equal(
      await readFile(path.join(dir, 'copy', 'sub', 'b.js'), 'utf8'),
      'export const b = 1;\n'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a stale or partial copy is drift, never a silent pass', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'atlas-snapshot-'));
  try {
    // The finding's shape: `bridge.js` read before `tsc` rewrote it, `late.js` missed.
    await put(path.join(dir, 'src/cli.js'), 'import "./bridge.js";\n');
    await put(path.join(dir, 'src/bridge.js'), 'export const e = 2;\n');
    await put(path.join(dir, 'src/late.js'), 'export const l = 1;\n');
    await put(path.join(dir, 'copy/cli.js'), 'import "./bridge.js";\n');
    await put(path.join(dir, 'copy/bridge.js'), 'export const e = 1;\n');

    assert.deepEqual(
      await copyMatches(path.join(dir, 'src'), path.join(dir, 'copy')),
      ['bridge.js', 'late.js']
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a rewrite mid-copy is redone, not frozen into the snapshot', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'atlas-snapshot-'));
  try {
    const source = path.join(dir, 'dist');
    await put(path.join(source, 'cli.js'), 'export const v = 1;\n');
    await put(path.join(source, 'sub/leaf.js'), 'export const l = 1;\n');

    let rewrites = 0;
    await copyVerified(source, path.join(dir, 'copy'), async () => {
      rewrites += 1;
      await writeFile(path.join(source, 'sub/leaf.js'), 'export const l = 2;\n');
    });

    assert.ok(rewrites > 1, `the drifted copy was redone (${rewrites} passes)`);
    assert.equal(
      await readFile(path.join(dir, 'copy', 'sub', 'leaf.js'), 'utf8'),
      'export const l = 2;\n'
    );
    assert.deepEqual(await copyMatches(source, path.join(dir, 'copy')), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a source that never settles answers instead of hanging the suite', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'atlas-snapshot-'));
  try {
    await put(path.join(dir, 'src/a.js'), 'export const a = 0;\n');
    let pass = 0;
    await assert.rejects(
      () =>
        copyVerified(path.join(dir, 'src'), path.join(dir, 'copy'), async () => {
          pass += 1;
          await writeFile(path.join(dir, 'src/a.js'), `export const a = ${pass};\n`);
        }, 2),
      /snapshot copy never settled after 2 attempts/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('buildSnapshot routes the build copy through that barrier', async () => {
  // The four tests above call copyVerified directly, so none of them would fail
  // if buildSnapshot quietly went back to a bare copyTree — the CI failure would
  // be one refactor away. This one drives buildSnapshot itself, on a fake
  // project root, so the wiring is what is under test.
  const dir = await mkdtemp(path.join(os.tmpdir(), 'atlas-snapshot-'));
  try {
    const project = path.join(dir, 'project');
    await put(path.join(project, 'dist/cli.js'), 'export const v = 1;\n');
    await put(path.join(project, 'package.json'), '{"version":"9.9.9"}\n');
    await put(path.join(project, 'node_modules/sentinel'), 'deps\n');

    let rewrites = 0;
    const snapshot = await buildSnapshot(project, async () => {
      rewrites += 1;
      await writeFile(path.join(project, 'dist/cli.js'), 'export const v = 2;\n');
    }, 3);

    assert.ok(rewrites > 1, `a verified mismatch was redone (${rewrites} passes)`);
    assert.equal(
      await readFile(path.join(snapshot, 'dist', 'cli.js'), 'utf8'),
      'export const v = 2;\n'
    );
    assert.deepEqual(
      await copyMatches(path.join(project, 'dist'), path.join(snapshot, 'dist')),
      []
    );

    // The two extras that make the copy runnable outside the repo.
    const manifest = JSON.parse(
      await readFile(path.join(snapshot, 'package.json'), 'utf8')
    ) as { version: string };
    assert.equal(manifest.version, '9.9.9');
    assert.ok((await lstat(path.join(snapshot, 'node_modules'))).isSymbolicLink());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
