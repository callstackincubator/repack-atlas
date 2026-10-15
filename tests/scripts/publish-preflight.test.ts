// publish-preflight: the pre-publish gates, unit-tested on their pure parts.
//
// The end-to-end path (pack + install + drive the installed CLI) is exercised by
// the command itself, and its output is recorded in
// docs/decisions/npm-publish.md. What is pinned here are the two behaviours a
// maintainer depends on and a refactor can silently break: G1 must never report
// PASS for an artifact missing a public entry point, and the gate list must stay
// the exact set the runbook promises.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  gateBin,
  gateManifest,
  gateNames,
} from '../../scripts/publish-preflight.mjs';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);

/** The evidence G1 consumes, built from the real repo so it cannot drift. */
function evidenceWith(overrides = {}) {
  const workflowsDir = path.join(repoRoot, '.github', 'workflows');
  return {
    manifest: JSON.parse(
      readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
    ),
    packedFiles: [
      'dist/cli.js',
      'dist/repack-bridge/plugin.js',
      'dist/repack-bridge/plugin.d.ts',
      'dist/repack-bridge/introspection-plugin.js',
      'dist/repack-bridge/introspection-plugin.d.ts',
      'README.md',
      'LICENSE',
    ],
    readme: '[a](LICENSE) [b](https://example.com/x)',
    repositoryUrl: 'https://github.com/callstackincubator/repack-atlas.git',
    workflows: readdirSync(workflowsDir)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map((f) => ({
        path: `.github/workflows/${f}`,
        text: readFileSync(path.join(workflowsDir, f), 'utf8'),
      })),
    ...overrides,
  };
}

test('G1 passes for the artifact the repo produces today', () => {
  const result = gateManifest(evidenceWith());
  assert.equal(result.gate, 'G1 manifest');
  assert.equal(result.status, 'PASS', `unexpected violations: ${result.detail}`);
});

test('G1 fails, never passes, when a public subpath stops shipping', () => {
  // Breaking `…/plugin` or `…/introspection` is exactly what a major version is
  // for (PRD §8.2); a preflight that waved it through would publish a lie.
  const result = gateManifest(
    evidenceWith({ packedFiles: ['dist/cli.js', 'README.md', 'LICENSE'] })
  );
  assert.equal(result.status, 'FAIL');
  assert.match(result.detail, /dangling-entry/);
});

test('G1 fails when the shipped README points at files that do not ship', () => {
  const result = gateManifest(
    evidenceWith({ readme: '[docs](docs/demo-showcase.md)' })
  );
  assert.equal(result.status, 'FAIL');
  assert.match(result.detail, /dead-link/);
});

test('unknown arguments answer 2, never a green run', async () => {
  const { main } = await import('../../scripts/publish-preflight.mjs');
  // A typo must not read as "ready to publish".
  assert.equal(await main(['--nope']), 2);
});

test('the gate list is the set the runbook promises', () => {
  assert.deepEqual(gateNames, [
    'G1 manifest',
    'G2 install',
    'G3 bin',
    'G4 public API',
    'G5 behavior',
    'G6 reproducibility',
  ]);
});

// G3 is the gate that answers "does the binary a user gets actually run". It
// used to shell out to `node dist/cli.js`, which keeps working even when the
// installed bin is broken: a cli.js without a shebang prints the version fine
// under node and dies with a syntax error when run through
// node_modules/.bin/repack-atlas. These tests pin the evidence shape that
// distinguishes the two.
test('G3 fails when the installed bin errors, even though node dist/cli.js works', () => {
  const result = gateBin({
    binCode: 2,
    binOut:
      "line 1: syntax error near unexpected token `('\n",
    cliCode: 0,
    cliStdout: 'repack-atlas 0.0.1',
    version: '0.0.1',
  });
  assert.equal(result.gate, 'G3 bin');
  assert.equal(result.status, 'FAIL');
  assert.match(result.detail, /installed bin/);
});

test('G3 fails when the installed bin prints a different version than the tarball', () => {
  const result = gateBin({
    binCode: 0,
    binOut: 'repack-atlas 0.0.1',
    cliCode: 0,
    cliStdout: 'repack-atlas 0.0.1',
    version: '0.2.0',
  });
  assert.equal(result.status, 'FAIL');
  assert.match(result.detail, /0\.2\.0/);
});

test('G3 passes only when the installed bin itself prints the packed version', () => {
  const result = gateBin({
    binCode: 0,
    binOut: 'repack-atlas 0.0.1',
    cliCode: 0,
    cliStdout: 'repack-atlas 0.0.1',
    version: '0.0.1',
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.detail, 'repack-atlas 0.0.1 via node_modules/.bin');
});
