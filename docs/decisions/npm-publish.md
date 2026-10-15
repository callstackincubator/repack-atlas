# Decision: publishing `repack-atlas` to npm

**Status: published.** `@callstack/repack-atlas@0.1.0` is on npm (tag `v0.1.0`).
This document records what was verified, what is decided, and what is still
open, so each release is a deliberate act and not an experiment. Sections that
say "before the first publish" describe the state the first release started
from and are kept as the evidence trail for the runbook.

`docs/PRD.md` §13 stays the source of truth for the packaging design and points
here for everything release-related.

## 1. Decided

| # | Decision | Owner |
| --- | --- | --- |
| 1 | **Publish manually.** No release workflow, no `changesets/action`, no `NPM_TOKEN`, no npm trusted-publisher configuration. | owner, 2026-10-14 |
| 2 | **changesets stays**, but as a local bookkeeping tool, not automation: it owns `version` bumps and `CHANGELOG.md`, and it is what puts PR + commit + GitHub author into the changelog. | owner, 2026-10-14 (requirement: "que en git aparezcan todos los releases… dando crédito al github user") |
| 3 | The runbook is `CONTRIBUTING.md` §Publishing to npm, mirrored as the `atlas-npm-publish` skill. | this change |
| 4 | `pnpm check:publish` runs in light CI: it is a **guard**, not a publisher. | this change |
| 5 | **The npm name is `@callstack/repack-atlas`.** Scoped, matching the incubator convention (never `@callstackincubator/`). The CLI binary stays `repack-atlas`, so nothing a user types changes. | owner, 2026-10-14 |
| 6 | **`pnpm publish:preflight` is the gate**: six checks on the installed tarball, and an agent stops for an explicit yes/no before `pnpm publish`. | owner, 2026-10-14 |
| 7 | **The first published version is `0.1.0`** — the `minor` changeset applied to `0.0.1`. Still `0.x`: the two public subpaths are not declared stable. | owner, 2026-10-14 |
| 8 | **`npm login` is done** on this machine as `eduardogracianock`; TFA mode `auth-and-writes`, so `pnpm publish` still needs a human OTP in a real terminal. | owner, 2026-10-14 |

## 2. Prerequisites the first publish had to clear

**The first version: `0.1.0`** — owner decision, 2026-10-14; published as such
on 2026-10-15. `0.x` on purpose:
nobody has said the `@callstack/repack-atlas/plugin` and
`@callstack/repack-atlas/introspection` subpaths are a stable contract yet — those are public API (PRD §8.2), and they
are also the reason this is not "just a CLI". The committed changeset is `minor`,
so the first `changeset version` on `0.0.1` lands on `0.1.0`; `pnpm changeset
status` reports exactly one minor bump for `@callstack/repack-atlas` and no other
package.

**Account prerequisites, re-checked 2026-10-14 (authenticated):**

- `@callstack/repack-atlas` was free on the registry (404) until the first
  publish claimed it.
- `npm login` was run by the owner in a real terminal: `npm whoami` answers
  `eduardogracianock`, a token sits in `~/.npmrc`, registry is
  `https://registry.npmjs.org/`. The E401 recorded earlier is resolved.
- TFA mode is `auth-and-writes` (`npm profile get`), so **every** publish asks for
  a fresh OTP: `pnpm publish` from an agent-run shell dies with `EOTP` and
  publishes nothing. The publish stays a human, terminal-side command.
- `npm access list packages @callstack` → `read-write` on 62 scoped packages,
  among them `@callstack/repack`, `@callstack/repack-init` and `@callstack/apex`.
  That proves write access to the scope's existing packages. **Claiming the new
  `@callstack/repack-atlas` name is still proven only by the publish itself** —
  npm has no pre-flight call for it, and a rejected publish leaves nothing behind.

**Sequencing, now resolved and observed.** The PR/commit links and the
`Thanks [@user]!` credit require a changeset naming a commit or PR that already
exists on GitHub, so the work had to land first: it is pushed as
`feat/npm-publish-readiness` and opened as **PR #79**. Replayed in a scratch clone
against the real GitHub API with `GITHUB_TOKEN="$(gh auth token)"`:

| changeset header | result |
| --- | --- |
| `commit: <pushed sha>` | `[#79](…/pull/79) [`ffbf781`](…/commit/ffbf781…) Thanks [@gedu]! - …` and `0.0.1 → 0.1.0` |
| `pr: #79` | `[#79](…/pull/79) Thanks [@gedu]! - …` (PR link + credit, no commit link) |
| `pr: #79` with **no** `GITHUB_TOKEN` | **refused**: "Please create a GitHub personal access token…", applied nothing, wrote no `CHANGELOG.md` |

So a release PR references itself as `pr: #<n>` (the number is known once the PR
is opened, before the version bump), and the runbook's "keep `GITHUB_TOKEN` set"
is load-bearing, not decorative.

**One consequence of the scope, in another repo:** `super-app-showcase` imports
`repack-atlas/plugin` / `repack-atlas/introspection` in four `rspack.config.ts`
and pins `"repack-atlas": "file:../../../repack-atlas"` in four `package.json`.
When Atlas ships as `@callstack/repack-atlas`, that demo branch moves to the
scoped specifier. Not a blocker here — nothing in this repo imports the root,
and the two subpaths ship unchanged.

## 2b. What used to be open

**The npm name** (resolved by decision 5 above). Recorded so the reasoning
survives: the incubator convention from the survey of the org's 48 repos is
unscoped or `@callstack/`, never `@callstackincubator/`; an earlier draft of
this proposal recommended the last one and was wrong. `react-native-atlas` is
taken (dead since 2022); `repack-doctor`, `repack-studio` and `federation-atlas`
were also free. PRD risk R5 ("Atlas" also names React Native's build system) was
already handled once by choosing the `repack-atlas` binary name (§16.1), and the
scoped package inherits that decision.

## 3. What the release notes look like, and what makes them work

`@changesets/changelog-github` produces, in `CHANGELOG.md`, a committed file:

```md
- [#76](https://github.com/callstackincubator/repack-atlas/pull/76)
  [`83045ae`](…commit/83045ae…) Thanks [@gedu](https://github.com/gedu)! - fix(studio): …
```

Observed behaviour, four runs against the real repo (not documentation):

| changeset says | `GITHUB_TOKEN` | result |
| --- | --- | --- |
| plain summary, no commit | absent | line with **no links, no credit** |
| plain summary, no commit | present | same — there is no commit to resolve |
| `commit: <pushed sha>` | present | the full line above |
| `commit: <pushed sha>` | absent | **refuses**: "Please create a GitHub personal access token…", and applies nothing |

So: keep `GITHUB_TOKEN` set when running `pnpm changeset version` —
`GITHUB_TOKEN="$(gh auth token)"` is enough, no PAT to mint. Failure is loud and
non-destructive, which is the good kind. `author: @user` in the changeset body
buys credit with no API call at all, for the offline case.

## 4. Why the guard exists

`pnpm check:publish` verifies the manifest against the **real** tarball from
`pnpm pack`, because predicting npm's packing rules is exactly how a package
ships without the file its `main` points at. On the commit before this change it
found, with no imagination required:

```
dangling-entry: main points at dist/index.js, which no packaged file provides
dangling-entry: types points at dist/index.d.ts, which no packaged file provides
dangling-entry: exports["."] points at dist/index.d.ts, which no packaged file provides
dangling-entry: exports["."] points at dist/index.js, which no packaged file provides
stale-dist-guard-missing: scripts.prepack must build dist before packing…
repository-missing: repository.url must name the git repo…
```

`main` pointed at a file `tsc` never emitted, and `import('repack-atlas')`
failed with `ERR_MODULE_NOT_FOUND`. Nothing in the repo imports the root, so the
root entry is gone rather than fixed. `prepack` now rebuilds `dist` on every
pack (≈1.1 s), which also closes the "published a stale `dist/`" hole, and
`pnpm publish --dry-run` was confirmed to run it.

An independent read-only verification pass then found four holes in that first
version of the guard, all since closed with a test each — worth recording,
because every one of them was a **vacuous pass**, i.e. the guard saying OK:

| Hole | How it passed | Now |
| --- | --- | --- |
| `--no-pack` skipped every manifest rule | nothing in CI or the docs used it; it could only ever report OK | flag removed; unknown args exit 2 |
| A self-dependency shipped in the tarball | `pnpm link` run inside the repo writes `"repack-atlas": "link:"` into `dependencies` + an override in `pnpm-workspace.yaml` — and it **actually happened during verification** | `self-dependency` rule, `dead-link`-style test |
| `changesets/action` + a custom publish script | the workflow regex matched only literal `pnpm publish`/`changeset publish`, so an `NPM_TOKEN` could ride along | `uses: changesets/action@` counts as publishing |
| README links to files that do not ship | `docs/demo-showcase.md` and the demo GIF resolve on GitHub and 404 on npmjs.com | `dead-link` rule, reading the README **as packed**; the three hits are fixed with absolute URLs |

Confirmed against a deliberately poisoned manifest, the guard now reports
`dangling-entry`, `stale-dist-guard-missing` and `self-dependency` and exits 1.

Related trap, verified: **installing from git does not work** for this package.
`files: ["dist"]` plus a gitignored `dist/` means a git install lands `LICENSE`,
`package.json` and `README.md` and nothing runnable — reproduced against the
GitHub URL and, on a clean clone of `HEAD` (no `prepare`, `0` files under `dist/`
in the tree), against `git+file://`, with the bin dying on a missing module.
Both README and the skill say "build from a clone", not "install from git".

Scope of that claim, honestly: it holds for **this manifest**. Whether adding a
`prepare` script would rescue git installs was *not* verified — the probe meant
to test it used a local `git+file://` path, which npm installs by copy without
running `prepare`, so it proved nothing either way. Do not add `prepare` on the
strength of this document.

One instruction in the README is equally evidence-bound: `pnpm link --global`
is rejected by the pinned pnpm 11 (`ERR_PNPM_LINK_BAD_PARAMS`); `pnpm link
<absolute-path-to-the-clone>` run from the consuming project is what works, and
that is what the README now says. Running any `pnpm link` **inside** the Atlas
repo is what writes the self-dependency above — do it from the consumer.

## 5. What manual publishing gives up

**No npm provenance.** npm only accepts a provenance attestation from a GitHub
Actions or GitLab cloud runner holding `id-token: write`; a laptop cannot
produce one. The package page will show no provenance badge, and
`npm audit signatures` will report a registry signature but no attestation. The
route stays open — a one-job `publish.yml` + a trusted-publisher connection is
the whole delta — and Re.Pack and Brownfield both already run that shape if the
trade ever stops being worth it.

Two facts to keep in mind if that day comes: a trusted-publisher connection
expires if it does not complete a first publish within 2 days, and since
2026-09-03 new connections default to stage-only unless "Allow npm publish" is
ticked.

## 6. State of this repository

Landed as **PR #79** (7 commits on `feat/npm-publish-readiness`, base
`origin/main` = `83045ae`): manifest fixed and renamed to
`@callstack/repack-atlas`, `check:publish` + `publish:preflight` with tests,
changesets config and one changeset, the CI guard, the runbook, the skill and
this document.

**Released 2026-10-15.** #79 merged as `b02ad27`; `changeset version` on a clean
`main` produced `0.0.1 → 0.1.0` (`2ca6983`); the human ran `pnpm publish` with a
fresh OTP; `npm view @callstack/repack-atlas version` answers `0.1.0` and
`v0.1.0` is tagged. The published tarball's sha256 matched the local `pnpm pack`
and the G6 hash, so the artifact users install is the one the gates tested.

Latest observed preflight before that publish, on `0.1.0`:

```
G1 manifest        PASS 247 packaged file(s)
G2 install         PASS fresh project installed @callstack/repack-atlas@0.1.0
G3 bin             PASS repack-atlas 0.1.0 via node_modules/.bin
G4 public API      PASS plugin, introspection -> function
G5 behavior        PASS drift fixture -> 1 + SHARED_VERSION_DRIFT; clean fixture -> 0
G6 reproducibility PASS two packs identical (fc7b2644933e…)
```

The hash is a property of the tree, so it moves whenever a file changes; read it
as "which bytes were probed", never as a version. The block above was recorded
from a run of this tree, so the commit that adds these lines already changes it —
that is expected, and exactly why the release runbook re-runs the preflight on the
release commit rather than trusting a quoted line. G6 is what makes the other five
worth reading — it proves the bytes installed in G2-G5 are the bytes `pnpm pack`
produces, i.e. the artifact probed is the artifact published.

## 7. What an independent review of this change found

A read-only verification pass over the branch found seven ways the guards could
report a **vacuous OK**, plus one false claim of its own. All are fixed with a test
each, and each is worth keeping in the record because every one of them looked
correct:

| Hole | How it passed | Now |
| --- | --- | --- |
| `stale-dist-guard-missing` accepted `prepack: "echo stale"` | only checked the field was a non-empty string | must mention `tsc` or `pnpm run build` |
| `dead-link` vanished with the README | `readme === undefined` skipped the rule, and nothing required README/LICENSE to ship | `required-file-missing` for both |
| `self-dependency` missed the unscoped name | matched `manifest.name` exactly, so the rename to `@callstack/…` disarmed the very rule written for the L11 incident | matches the base name too, scoped or not |
| `repository-mismatch` vanished when git could not answer | `originUrl()` swallowed the failure into `undefined`, and the rule needed a reference | `.changeset/config.json` supplies the canonical repo, so a fork clone is neither falsely red nor silently unchecked |
| G3 certified a broken bin | ran `node dist/cli.js`, which works even with no shebang; reproduced in a scratch clone where the user's `node_modules/.bin/repack-atlas` died with a syntax error while G3 said PASS | runs the installed bin, keeps `node dist/cli.js` only as diagnostic |
| G2 printed a name it never read | `PASS` was built from a hardcoded constant | PASS requires the installed manifest's version to match the packed one |
| G6 could compare one file twice | both packs wrote into one directory and the listing re-found the first tarball | each pack gets its own directory, and two tarballs in one is an error |

Two honest limits left, both follow-ups rather than blockers:

- **The gates prove `pnpm pack` bytes.** `npm pack` keeps `prepack` and
  `packageManager`, which the packer strips, so its tarball is not byte-identical
  (`5813aef9…` vs `10efa20d…` on the same tree). The runbook publishes with `pnpm
  publish`; anyone typing `npm publish` uploads bytes no gate examined.
- **The packed manifest is not what G1 reads.** G1 and `check:publish` validate the
  working-tree `package.json`, so the `prepack` and `packageManager` fields they
  require are asserted about a manifest that is not shipped. That is intended —
  those fields exist to protect the build — but it means "G1 PASS" is a statement
  about the source manifest, not the published one.

Uninspected by any gate, and a packaging decision rather than a defect: the
122 `.map` files are ~34% of the uncompressed artifact and reference `../../src/…`
paths that do not ship, and the shipped manifest carries 11 `devDependencies` plus
`scripts` pointing at files that do not ship.
