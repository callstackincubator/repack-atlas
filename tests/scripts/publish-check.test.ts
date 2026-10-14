// publish-check: the publish manifest must be honest before anything can be
// packaged (docs/decisions/npm-publish.md; the release playbook mirrors Re.Pack's
// CONTRIBUTING.md "Publishing a release").
//
// Two kinds of guarantee live here. The pure rules are unit-tested against
// synthetic manifests, and the real repo is asserted clean through the same
// public entry point the CI step uses — a rule that never fires on the shipped
// manifest is worthless, so the repo itself is a fixture.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import {
  formatViolations,
  validateManifest,
  validateWorkflows,
} from '../../scripts/publish-check.mjs';

const exec = promisify(execFile);
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);

/** The minimum a publish needs, expressed as the checker sees it. */
function manifestWith(overrides = {}) {
  return {
    name: 'repack-atlas',
    version: '0.1.0',
    description: 'Local developer tooling for Re.Pack Module Federation.',
    license: 'MIT',
    type: 'module',
    engines: { node: '>=22.13' },
    bin: { 'repack-atlas': './dist/cli.js' },
    exports: {
      './plugin': './dist/repack-bridge/plugin.js',
      './introspection': './dist/repack-bridge/introspection-plugin.js',
    },
    files: ['dist'],
    scripts: { prepack: 'tsc -p tsconfig.json' },
    repository: { type: 'git', url: 'https://github.com/o/r.git' },
    publishConfig: { registry: 'https://registry.npmjs.org/', access: 'public' },
    ...overrides,
  };
}

// README.md and LICENSE are in every real tarball (npm always includes them),
// so the happy-path fixture carries them; `required-file-missing` has its own
// test that drops them.
const PACKED = [
  'dist/cli.js',
  'dist/repack-bridge/plugin.js',
  'dist/repack-bridge/introspection-plugin.js',
  'README.md',
  'LICENSE',
];

const rules = (violations: { rule: string }[]) => violations.map((v) => v.rule);

test('accepts a manifest whose every entry point ships', () => {
  assert.deepEqual(validateManifest(manifestWith(), { packedFiles: PACKED }), []);
});

test('a main/types target that never gets built is a dangling-entry', () => {
  // The real defect this rule exists for: main pointed at dist/index.js, which
  // `tsc` never emits, so `import('repack-atlas')` threw ERR_MODULE_NOT_FOUND.
  const violations = validateManifest(
    manifestWith({ main: './dist/index.js', types: './dist/index.d.ts' }),
    { packedFiles: PACKED }
  );
  assert.deepEqual(rules(violations).filter((r) => r === 'dangling-entry').length, 2);
  assert.match(
    formatViolations(violations).join('\n'),
    /dangling-entry: main points at dist\/index\.js, which no packaged file provides/
  );
});

test('a missing repository url blocks publishing', () => {
  const violations = validateManifest(manifestWith({ repository: undefined }), {
    packedFiles: PACKED,
  });
  assert.ok(rules(violations).includes('repository-missing'));
});

test('a repository url that is not the origin repo is a provenance mismatch', () => {
  // npm validates repository.url against the GitHub repo for provenance.
  const violations = validateManifest(
    manifestWith({ repository: 'https://github.com/someone/else.git' }),
    { packedFiles: PACKED, repositoryUrl: 'https://github.com/o/r' }
  );
  assert.ok(rules(violations).includes('repository-mismatch'));
  assert.match(formatViolations(violations).join('\n'), /expected https:\/\/github.com\/o\/r/);
});

test('a repository url matching origin is accepted in any url shape', () => {
  for (const url of [
    'https://github.com/o/r.git',
    'git@github.com:o/r.git',
    'https://github.com/o/r',
  ]) {
    assert.deepEqual(
      validateManifest(manifestWith({ repository: url }), {
        packedFiles: PACKED,
        repositoryUrl: 'https://github.com/o/r.git',
      }),
      [],
      `${url} should normalize to o/r`
    );
  }
});

test('without a prepack build the published dist can be stale', () => {
  const violations = validateManifest(manifestWith({ scripts: {} }), {
    packedFiles: PACKED,
  });
  assert.ok(rules(violations).includes('stale-dist-guard-missing'));
});

test('a scoped package must publish public', () => {
  const violations = validateManifest(
    manifestWith({ name: '@callstack/repack-atlas', publishConfig: { registry: 'x' } }),
    { packedFiles: PACKED }
  );
  assert.ok(rules(violations).includes('publish-access-missing'));
});

test('files must ship dist or the package is empty', () => {
  const violations = validateManifest(manifestWith({ files: ['README.md'] }), {
    packedFiles: ['README.md'],
  });
  assert.ok(rules(violations).includes('files-missing-dist'));
});

test('every publishable field the registry or provenance needs is required', () => {
  for (const field of ['name', 'version', 'description', 'license', 'engines', 'bin']) {
    const violations = validateManifest(manifestWith({ [field]: undefined }), {
      packedFiles: PACKED,
    });
    assert.ok(rules(violations).includes('missing-field'), `${field} must be required`);
    assert.match(formatViolations(violations).join('\n'), new RegExp(field));
  }
});

test('a non-MIT license is reported, not silently published', () => {
  const violations = validateManifest(manifestWith({ license: 'ISC' }), {
    packedFiles: PACKED,
  });
  assert.ok(rules(violations).includes('license-not-mit'));
});

test('publishing workflows must not carry long-lived npm tokens', () => {
  // Re.Pack CONTRIBUTING.md: "Do not add NPM_TOKEN or NODE_AUTH_TOKEN secrets".
  const violations = validateWorkflows([
    {
      path: '.github/workflows/release.yml',
      text: 'jobs:\n  p:\n    steps:\n      - run: pnpm changeset publish\n        env:\n          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}\n',
    },
  ]);
  assert.ok(rules(violations).includes('publish-token-secret'));
});

test('the workflow that publishes must hold an OIDC id-token', () => {
  const violations = validateWorkflows([
    { path: '.github/workflows/release.yml', text: 'name: Release\nsteps:\n  - run: pnpm release\n' },
  ]);
  assert.ok(rules(violations).includes('publish-id-token-missing'));

  const clean = validateWorkflows([
    {
      path: '.github/workflows/release.yml',
      text: 'permissions:\n  id-token: write\nsteps:\n  - run: pnpm changeset publish\n',
    },
  ]);
  assert.deepEqual(clean, []);
});

test('workflows that never publish are out of scope', () => {
  assert.deepEqual(
    validateWorkflows([
      { path: '.github/workflows/ci.yml', text: 'name: CI\nsteps:\n  - run: pnpm test\n' },
    ]),
    []
  );
});

test('the package must not depend on itself', () => {
  // A `pnpm link` run inside the repo writes `"repack-atlas": "link:"` into
  // dependencies, and that reaches the published tarball. Observed for real.
  const violations = validateManifest(
    manifestWith({ dependencies: { 'repack-atlas': 'link:' } }),
    { packedFiles: PACKED }
  );
  assert.ok(rules(violations).includes('self-dependency'));
});

test('a changesets/action workflow counts as publishing', () => {
  // The action runs a maintainer-chosen publish script, so the token can ride
  // alongside it without the word `publish` appearing in a run step.
  const violations = validateWorkflows([
    {
      path: '.github/workflows/release.yml',
      text: 'steps:\n  - uses: changesets/action@abc # v2\n    with:\n      publish: pnpm ci:publish\n    env:\n      NPM_TOKEN: ${{ secrets.NPM_TOKEN }}\n',
    },
  ]);
  assert.ok(rules(violations).includes('publish-token-secret'));
  assert.ok(rules(violations).includes('publish-id-token-missing'));
});

test('a relative README link to a file that does not ship is a dead-link', () => {
  // The published README renders on npmjs.com with no repository behind it:
  // a relative link to docs/ is a 404 for anyone reading it there.
  const violations = validateManifest(
    manifestWith(),
    {
      packedFiles: [...PACKED, 'README.md', 'LICENSE'],
      readme: '[demo](docs/demo-showcase.md) [lic](LICENSE) [ext](https://x.dev/a)',
    }
  );
  assert.ok(rules(violations).includes('dead-link'));
  assert.match(formatViolations(violations).join('\n'), /docs\/demo-showcase\.md/);
  assert.ok(
    !formatViolations(violations).join('\n').includes('LICENSE'),
    'a shipped target and an absolute url must not be reported'
  );
});

test('the real repo manifest passes the CI step', async () => {
  // This is the regression net: it is the same command CI runs.
  const { stdout } = await exec('node', ['scripts/publish-check.mjs'], { cwd: repoRoot });
  assert.match(stdout, /publish-check: OK/);
});

// Every rule below was added because an independently-found **vacuous pass**
// let the guard say OK on an artifact that must not ship. A rule that cannot
// fail is worse than no rule: it is a green light with nothing behind it. Each
// test reproduces the exact shape that used to pass.
test('a no-op prepack is not a stale-dist guard', () => {
  // dist/ is gitignored, so "prepack" only guards a publish if it builds.
  const violations = validateManifest(
    manifestWith({ scripts: { prepack: 'echo stale' } }),
    { packedFiles: PACKED }
  );
  assert.ok(rules(violations).includes('stale-dist-guard-missing'));
});

test('a prepack that does not build is not a stale-dist guard', () => {
  const violations = validateManifest(
    manifestWith({ scripts: { prepack: 'node scripts/nope.mjs' } }),
    { packedFiles: PACKED }
  );
  assert.ok(rules(violations).includes('stale-dist-guard-missing'));
});

test('the shipped README and LICENSE are required in the artifact', () => {
  // Without this, deleting README.md silently disables the dead-link rule too.
  const violations = validateManifest(manifestWith(), {
    packedFiles: ['dist/cli.js'],
  });
  const found = rules(violations);
  assert.ok(found.includes('required-file-missing'), found.join(','));
});

test('a self-dependency under the old package name is still a self-dependency', () => {
  // The rename to @callstack/repack-atlas disarmed the original rule, whose
  // match was name-exact. A stray `pnpm link` writes the unscoped name.
  const violations = validateManifest(
    manifestWith({ name: '@callstack/repack-atlas', dependencies: { 'repack-atlas': 'link:' } }),
    { packedFiles: PACKED }
  );
  assert.ok(rules(violations).includes('self-dependency'));
});

test('a mismatched repository url is reported even when git cannot answer', () => {
  // originUrl() swallows a git failure to undefined; the rule used to
  // short-circuit there, so an unverified manifest passed.
  const violations = validateManifest(
    manifestWith({
      repository: { type: 'git', url: 'https://github.com/someone/wrong-repo.git' },
    }),
    { packedFiles: PACKED, expectedRepositoryUrl: 'https://github.com/callstackincubator/repack-atlas.git' }
  );
  assert.ok(rules(violations).includes('repository-mismatch'));
});

test('publishing through a custom script is still publishing', () => {
  // The workflow rules matched literal `pnpm publish`/`changeset publish`, so a
  // job shelling out to scripts/ship-it.sh hid an NPM_TOKEN.
  const violations = validateWorkflows([
    {
      path: '.github/workflows/ship.yml',
      text:
        'jobs:\n  publish:\n    runs-on: ubuntu-latest\n    env:\n      NPM_TOKEN: ${{ secrets.NPM_TOKEN }}\n    steps:\n      - run: ./scripts/ship-it.sh\n',
    },
  ]);
  assert.ok(rules(violations).includes('publish-token-secret'), JSON.stringify(violations));
});

test('a fork clone is not falsely red: the canonical repo is the reference', () => {
  // Contributors clone forks, so origin is a personal fork while repository.url
  // names upstream. Comparing only against origin reported a violation on a
  // correct manifest, which trains people to ignore the guard.
  const violations = validateManifest(manifestWith(), {
    packedFiles: PACKED,
    repositoryUrl: 'https://github.com/someone/fork.git',
    expectedRepositoryUrl: 'https://github.com/o/r.git',
  });
  assert.deepEqual(violations, []);
});
