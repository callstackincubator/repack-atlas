// specifier-check: the guard that keeps the published import specifier scoped
// (#80). Detection is driven with in-memory text so a fixture cannot rot with
// the repository. The two constants below are the only places in this file that
// spell the wrong form, which is why the repository-tree test at the bottom can
// run against the real tree.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  ALLOW_PRAGMA,
  EXCLUDED_PREFIXES,
  findUnscopedSpecifiers,
} from '../../scripts/specifier-check.mjs';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const script = path.join(repoRoot, 'scripts', 'specifier-check.mjs');

/** What the rule exists to catch: the pre-rename public subpath. */
const BAD_PLUGIN = 'repack-atlas/plugin'; // allow-unscoped-specifier
const BAD_INTROSPECTION = 'repack-atlas/introspection'; // allow-unscoped-specifier

/** Lines the rule flagged, 1-based, within the snippet. */
const hitLines = (text: string) =>
  findUnscopedSpecifiers('docs/a.md', text).map((v) => v.line);

test('flags the unscoped public subpath, in code and in prose', () => {
  assert.deepEqual(hitLines(`import { P } from '${BAD_PLUGIN}';`), [1]);
  assert.deepEqual(hitLines(`add the ${BAD_INTROSPECTION} plugin first`), [1]);
});

test('accepts the scoped specifier', () => {
  assert.deepEqual(
    hitLines(`import { P } from '@callstack/repack-atlas/plugin';`),
    [],
  );
  assert.deepEqual(
    hitLines('the `@callstack/repack-atlas/introspection` subpath is public API'),
    [],
  );
});

test('leaves the four names that keep their spelling alone', () => {
  // #80: only the import specifier is scoped. The binary, the clone directory,
  // the per-app dotdir and the root config all keep their current names, and
  // each shares the `repack-atlas` substring. A rule that flagged these would
  // be unusable, so they are pinned here.
  const text = [
    'repack-atlas --version', // the binary
    'cd repack-atlas && pnpm build', // the clone directory
    'file:../../../repack-atlas', // a path into the clone
    'no facts at /app/.repack-atlas/introspection.json', // the dotdir artifact
    'node ../repack-atlas/dist/cli.js doctor', // a path into the clone
    'repack-federation.json is the root config', // the root artifact
  ].join('\n');
  assert.deepEqual(hitLines(text), []);
});

test('a path, a hyphen or a scope never turns into a specifier', () => {
  assert.deepEqual(hitLines(`see my-${BAD_PLUGIN} notes`), []);
  assert.deepEqual(hitLines(`see ./${BAD_PLUGIN} notes`), []);
  assert.deepEqual(hitLines(`see @scope/${BAD_PLUGIN} notes`), []);
});

test('the pragma allows one line and only that line', () => {
  assert.deepEqual(
    hitLines(`an unscoped ${BAD_INTROSPECTION} installs nothing ${ALLOW_PRAGMA}`),
    [],
  );
  // A pragma must not become a section-wide mute: the next line is still read.
  assert.deepEqual(
    hitLines(
      [`context ${ALLOW_PRAGMA}`, `then use ${BAD_PLUGIN} here`].join('\n'),
    ),
    [2],
  );
});

test('the pragma only counts at the end of the line', () => {
  // Review feedback on #81: a bare `includes` turned any mention of the word
  // into a mute, so quoting the pragma in prose or suffixing it disabled the
  // rule from anywhere. The exemption is an end-of-line marker; anything
  // else keeps the line under the rule.
  assert.deepEqual(
    hitLines(`use ${BAD_PLUGIN} now // ${ALLOW_PRAGMA} is documented above`),
    [1],
  );
  assert.deepEqual(
    hitLines(`use ${BAD_PLUGIN} now // ${ALLOW_PRAGMA}-disabled`),
    [1],
  );
  assert.deepEqual(
    hitLines(`see ${ALLOW_PRAGMA} earlier for ${BAD_PLUGIN}`),
    [1],
  );
  // Trailing whitespace and comment punctuation before the marker stay fine.
  assert.deepEqual(
    hitLines(`use ${BAD_PLUGIN} now // ${ALLOW_PRAGMA}  `),
    [],
  );
});

test('an unrelated word does not silence the rule', () => {
  assert.deepEqual(hitLines(`allow ${BAD_PLUGIN} here`), [1]);
});

test('reports path, line and the offending text', () => {
  const found = findUnscopedSpecifiers(
    'src/x.ts',
    `first line\nuse ${BAD_PLUGIN} now`,
  );
  assert.equal(found.length, 1);
  const violation = found[0];
  assert.ok(violation, 'the offending line must be reported');
  assert.equal(violation.path, 'src/x.ts');
  assert.equal(violation.line, 2);
  assert.match(violation.text, /repack-atlas\/plugin/);
});

test('history under odd/ is out of scope', () => {
  assert.ok(EXCLUDED_PREFIXES.includes('odd/'));
});

test('the tracked tree is clean today, so the gate is not vacuous', () => {
  const out = execFileSync('node', [script], { cwd: repoRoot, encoding: 'utf8' });
  assert.match(out, /specifier-check: OK/);
});

test('an unknown argument is not read as a pass', () => {
  let status = 0;
  try {
    execFileSync('node', [script, '--nope'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (error) {
    status = (error as { status?: number }).status ?? 0;
  }
  assert.equal(status, 2);
});
