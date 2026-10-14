# Contributing to Repack Atlas

Thanks for being here. This repo is deliberately small and deliberately strict
about a few things; this document explains the rules and, more importantly,
how to reproduce every CI check on your machine.

## Issue first

Work starts from an issue, not from a PR.

1. Open an issue (bug or feature template).
2. Wait for a maintainer to apply `status:approved`. Approved, unclaimed work
   carries `up-for-grabs`.
3. Only then open a PR that links the issue: `Closes #N` (or `Fixes`,
   `Resolves`, `Refs`). The PR body check fails without one.

This exists because review bandwidth is the scarcest resource here (PRD §11,
risk R3). An approved issue means the design conversation already happened.

## Dev setup

```bash
# Node >= 22.13, pnpm >= 10 (exact version in package.json packageManager)
pnpm install
pnpm build     # tsc: src -> dist; the CLI and fixture tests run against dist/
pnpm test      # 274 node:test tests over the fixture workspaces, seconds
```

## Commits and PR size

- **Conventional Commits**: `type(scope): imperative summary`, where type is
  one of `feat|fix|docs|test|chore|refactor|perf|build|ci|style|revert` and
  the header is at most 100 characters. The PR title and every commit in the
  PR must match, and `fixup!`/`squash!` commits must be squashed first. CI
  enforces this with `scripts/commit-check.mjs`.
- **No AI attribution.** No `Co-Authored-By` (or `Reviewed-by`, `Signed-off-by`,
  ...) trailer naming an AI tool, no "Generated with" banners, and no AI tool
  as commit author. CI rejects them; human co-authors are fine. See
  [AI_POLICY.md](AI_POLICY.md).
- Check locally before pushing: `pnpm check:commits` (commits since
  `origin/main`), `pnpm check:commits --range <base>..<head>`, or
  `pnpm check:commits --message "feat: add thing"` for a PR title.
- **Work units**: each commit is reviewable on its own, with its tests and doc
  updates in the same commit.
- **400-line budget**: PRs must stay under 400 changed lines
  (additions + deletions). Above that, split into chained PRs or ask a
  maintainer for the `size:exception` label. CI computes the number with
  `git diff --numstat` (ignoring `pnpm-lock.yaml`) and fails otherwise.
- Add exactly one `type:*` label.

## Exit codes and JSON output

Every command follows the same contract (AGENTS.md rule 6):

- `0` clean, warnings allowed
- `1` ran and found errors
- `2` could not answer

`1` and `2` must never collapse into each other. Everything user-visible has a
`--json` twin with an `exitCode` field mirroring the process exit code. If you
add a finding, add a fixture variant for it too (skill:
`atlas-doctor-finding`).

## Adding a skill

Skills are how this repo teaches agents (and humans) its conventions.

1. Create `.agents/skills/<name>/SKILL.md` with frontmatter: `name` (matching
   the folder), `description` (the trigger text, <= 1024 chars), and optional
   `metadata.auto_invoke` rows.
2. Run `pnpm agent:sync`. It creates the `.claude/skills/<name>` symlink and
   regenerates the AGENTS.md tables between their marker comments.
3. Commit the skill, the symlink, and the AGENTS.md diff together. CI runs
   `pnpm agent:check` and fails on any drift.

## What CI runs, and how to reproduce it

CI is split to keep a public repo cheap on Actions minutes:

- `.github/workflows/ci.yml` is the **light** CI. Every PR and every push to
  `main` runs one Linux / Node 22 job with the steps below.
- `.github/workflows/ci-full.yml` is the **full** CI: the build-and-test matrix
  (macOS Node 22 + 24, Linux Node 24) and the Studio e2e job. It runs only when
  a maintainer adds the `ready-to-merge` label to the PR (the label must exist
  in the repo) or triggers it by hand with `workflow_dispatch`. A skipped full
  job means "not requested yet", not "passed": add the label and wait for it
  to go green before merging.
- `.github/workflows/pr-checks.yml` holds the PR gates (title, commit
  messages, size, linked issue).

Every job step maps to one local command. All outputs below are from this
checkout, observed 2026-09-30.

| CI step | Local command | Observed result |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | lockfile is committed; keep it in sync with package.json |
| Lint | `pnpm lint` | silent, exit 0 |
| Typecheck | `pnpm typecheck` | silent, exit 0 |
| Build | `pnpm build` | silent, exit 0 (`src` -> `dist`) |
| Test | `pnpm test` | `tests 948 / pass 948 / fail 0` (observed 2026-10-14) |
| Agent files | `pnpm agent:check` | `agent-sync: OK ...`, exit 0 |
| Vendored provenance | `pnpm check:vendored` | `vendored-check: OK - 6 vendored file(s) accounted for in VENDORED.md` |
| Publish manifest | `pnpm check:publish` | `publish-check: OK - repack-atlas@<v> with 247 packaged file(s), 3 workflow(s) checked` |
| Commit messages (PR gate) | `pnpm check:commits` | `commit-check: OK - N item(s) checked` |
| Studio e2e | `pnpm test:e2e` | `7 passed`, needs `pnpm exec playwright install chromium` |

Two gotchas when reproducing locally:

- **Stale Studio server**: `playwright.config.ts` reuses an existing server on
  port 8099 outside CI (`reuseExistingServer: !process.env.CI`). If a previous
  `dev` or preview run is still listening, kill it before trusting e2e output:
  `lsof -ti :8099 | xargs kill`.
- **`pnpm test` rebuilds first**: `pretest` runs `pnpm build`, because CLI
  tests spawn `dist/cli.js` against the fixtures.

## The architectural fences

ESLint enforces two rules that look like noise until they save you:

- **Bridge fence**: nothing outside `src/repack-bridge/**` may import anything
  under `**/vendored/**`.
- **Core boundary**: `src/core/**` never imports the bridge, adapters, or any
  bundler package.

If one of them fires on your change, the fix is almost always to move code to
the right layer, not to add an ignore. PRs that weaken a guard to pass CI get
closed.

## Publishing to npm

Publishing is manual for now: no release workflow, no npm token, no trusted
publisher. One maintainer runs the steps below from a clean `main`. The full
decision record and the evidence for each choice is
[`docs/decisions/npm-publish.md`](docs/decisions/npm-publish.md); the same steps
are a skill (`.agents/skills/atlas-npm-publish`) so an agent can walk them with
you.

### Every release

**Before the first release only**: the npm name (`@callstack/repack-atlas`) and
the first version (`0.1.0`) are answered in
[`docs/decisions/npm-publish.md`](docs/decisions/npm-publish.md) §1–§2 — that
section also states what must still be true at publish time: an authenticated
session (`npm whoami`, TFA `auth-and-writes`), and the branch landed, because
step 2 can only link a changeset to a commit or PR that already exists on
GitHub.

1. The release must be described by a changeset. Contributors add one per PR
   (`pnpm changeset`, or the "Add a changeset" section below); the release PR
   that only bumps versions does not need one.
2. Make sure `main` is clean and up to date, then generate the release:

   ```bash
   GITHUB_TOKEN="$(gh auth token)" pnpm changeset version
   ```

   This bumps `version`, writes `CHANGELOG.md`, and deletes the consumed
   changeset files. Keep `GITHUB_TOKEN` set: it is what turns a changelog line
   into `[#123] [`a1b2c3d`] Thanks [@author]! - …`. Without it the run either drops
   the links (no commit referenced) or stops with "Please create a GitHub
   personal access token" (a `commit:` line was referenced). See
   `docs/decisions/npm-publish.md` §3 for the four observed behaviours.
3. Review `CHANGELOG.md` and `package.json`, then commit:
   `chore(release): v<version>`.
4. Prove the artifact before the registry ever sees it:

   The preflight runs every gate against the packed tarball installed into a
   throwaway project — never against the working tree, which is not what users
   receive. About 25 s, self-cleaning (`--keep` leaves the scratch tree).

   ```bash
   pnpm publish:preflight
   ```

   | Gate | Proves |
   |---|---|
   | G1 manifest | every entry point ships; MIT; `prepack` guard; no self-dependency; no dead links in the **packed** README |
   | G2 install | a fresh project installs the tarball |
   | G3 bin | the installed binary prints the packed version |
   | G4 public API | `…/plugin` and `…/introspection` import as functions |
   | G5 behavior | doctor answers `1` + `SHARED_VERSION_DRIFT` on the drift fixture, `0` on the clean one, through the installed artifact |
   | G6 reproducibility | two `pnpm pack` runs are byte-identical |

   Exit `1` = a gate failed or was skipped → do not publish. Exit `2` = could not
   answer → also do not publish. A missing gate is never a pass.

5. Publish (requires npm 2FA; publish interactively in a real terminal — a
   non-interactive shell fails with `EOTP` and publishes nothing):

   ```bash
   pnpm publish
   ```

   `prepack` rebuilds `dist` from source, so a publish can never ship a stale
   tree. The version can never be reused, even after unpublishing.

   A manual publish cannot carry **npm provenance**: the registry only accepts
   a provenance attestation from a GitHub Actions / GitLab cloud runner with
   `id-token: write`, so the package page will show no provenance badge. That
   is the price of publishing by hand, and `docs/decisions/npm-publish.md` §5
   keeps the CI route open if it ever starts to matter.
6. Tag and push, only after `npm view @callstack/repack-atlas version` agrees:
   `git tag v<version> && git push && git push --tags`.

### Add a changeset

One file under `.changeset/<random-name>.md` per released change:

```markdown
---
"repack-atlas": minor
---

add doctor --json output
```

`patch` for fixes, `minor` for features, `major` for breaking changes to
`repack-atlas/plugin` or `repack-atlas/introspection` — those two subpaths are
public API (PRD §8.2). Optional header lines, each on its own line before the
summary: `commit: <full-sha>` or `pr: #<n>` to get links and author credit from
GitHub (needs `GITHUB_TOKEN`), or `author: @<user>` for credit alone with no
API call.

## PR checklist

The template at `.github/pull_request_template.md` is the checklist. The two
items people skip: paste real output for checks you claim passed (AGENTS.md
rule 9), and disclose material AI assistance per AI_POLICY.md.
