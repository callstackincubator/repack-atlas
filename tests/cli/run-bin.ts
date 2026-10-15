// Shared plumbing for the spawned-bin CLI tests (not a test file itself).
//
// These tests spawn the BUILT bin — the real process, the real argv path, the
// real exit code. `package.json` wires a `pretest` build so `pnpm test` always
// runs against a fresh `dist/`; when the build is missing (someone invoked the
// test runner directly), `ensureBin()` fails with an actionable message instead
// of a confusing ENOENT.
//
// They spawn a *snapshot* of `dist/`, never `repo/dist/` itself. `node:test`
// runs test files in concurrent processes, and `tests/scripts/publish-check.test.ts`
// runs `scripts/publish-check.mjs`, whose `pnpm pack` fires `prepack` and
// rewrites `repo/dist/` file by file while other files are spawning from it.
// `tests/cli/bin-snapshot.test.ts` pins the CI failure that race produced. The
// publish guard keeps packing the real repo — only the readers move.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { rmSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  stat,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);

/** The build output in the repository — the tree `tsc` rewrites in place. */
export const repoBinPath = path.join(repoRoot, 'dist', 'cli.js');

/**
 * The bin the spawned-bin tests execute. `ensureBin()` repoints it at an
 * immutable snapshot; it stays a `let` so importers see the repointed value
 * through the ESM live binding.
 */
export let binPath = repoBinPath;
export const fixturesDir = path.join(repoRoot, 'fixtures');

export interface BinResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Spawn `node dist/cli.js ...args`; never throws on non-zero exit. */
export async function runBin(
  ...args: string[]
): Promise<BinResult> {
  try {
    const { stdout, stderr } = await exec(process.execPath, [binPath, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    assert.equal(
      typeof failure.code,
      'number',
      `bin crashed rather than exited with a code: ${String(error)}`
    );
    const code = failure.code as number;
    return {
      code,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

/** One snapshot per test process, shared by every `ensureBin()` caller. */
let snapshotRoot: Promise<string> | undefined;

/**
 * Copy the build to a throwaway directory outside the repository so no spawn
 * can catch `tsc` halfway through rewriting it. Two extras make the copy behave
 * exactly like the in-repo tree:
 *
 * - the root `package.json`, because `dist/cli/version.js` reads `../../package.json`;
 * - a `node_modules` link, so bare imports (`ink`, `react`, `@clack/prompts`)
 *   resolve by walking up from the snapshot rather than by luck of location.
 */
async function buildSnapshot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-bin-snapshot-'));
  await copyTree(path.join(repoRoot, 'dist'), path.join(root, 'dist'));
  await copyFile(
    path.join(repoRoot, 'package.json'),
    path.join(root, 'package.json')
  );
  await symlink(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'));
  process.on('exit', () => {
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

/**
 * Assert the build exists and point `binPath` at an immutable snapshot of it.
 * Await this from a `before()` hook before spawning anything.
 */
export async function ensureBin(): Promise<void> {
  const info = await stat(repoBinPath).catch(() => null);
  assert.ok(
    info !== null,
    `${repoBinPath} is missing — run \`pnpm build\` first (pnpm test does this via pretest)`
  );
  snapshotRoot ??= buildSnapshot();
  binPath = path.join(await snapshotRoot, 'dist', 'cli.js');
}

/** Parse a `--json` payload, failing with the raw output when unparseable. */
export function parseJson<T = Record<string, unknown>>(raw: string): T {
  assert.doesNotThrow(
    () => JSON.parse(raw),
    `expected JSON on stdout, got:\n${raw}`
  );
  return JSON.parse(raw) as T;
}

/** Recursive copy for fixture trees (small, no symlinks, few files). */
export async function copyTree(
  source: string,
  destination: string
): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else await copyFile(from, to);
  }
}
