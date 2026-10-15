---
name: atlas-npm-publish
description: >-
  Walk a maintainer through publishing repack-atlas to npm by hand: changeset
  version bump with GitHub credit, the tarball probe, the publish, and the tag.
  Publishing is manual by decision — no release workflow, no tokens, no trusted
  publisher.
  Trigger: publishing to npm, "voy a publicar esto a npm", releasing a version,
  bumping the package version, writing CHANGELOG.md, a changeset question, or
  anything that would run `pnpm publish` or `changeset version`.
metadata:
  auto_invoke:
    - "publishing repack-atlas to npm or preparing a release"
    - "running changeset version or bumping package.json version"
    - "editing .changeset/ or CHANGELOG.md"
    - "changing package.json entry points, files, or publishConfig"
---

# Publish repack-atlas to npm (manual)

Read `docs/decisions/npm-publish.md` first: it holds the open decisions (npm
name, first version) and the evidence behind every rule below.
`CONTRIBUTING.md` §Publishing to npm is the same runbook for humans.

## Stop before you publish

Two questions are **not yours to answer**, and both are irreversible once the
registry sees them. The name is settled — `@callstack/repack-atlas`, first
version `0.1.0`, published 2026-10-15 (`docs/decisions/npm-publish.md` §1). In a
later release the version comes from the pending changesets, never from a guess.
Re-ask whenever either is unanswered again:

1. **The npm name.** Unscoped or `@callstack/…`, never `@callstackincubator/…`.
   If `package.json` still says `repack-atlas` and the maintainer has not named
   the package, stop and ask.
2. **The version.** `0.x` unless the maintainer says the
   `@callstack/repack-atlas/plugin` and `@callstack/repack-atlas/introspection`
   subpaths are stable; a breaking change to either is a `major`.

A version can never be republished, even after unpublishing. If either answer
is missing, do not run anything below; report the question.

Three preconditions for the changelog to be worth reading — check them before
step 1, all cheap:

- **Logged in**: `npm whoami` prints the maintainer. TFA mode is
  `auth-and-writes`, so `npm profile get` shows it and every publish needs a
  fresh OTP: `pnpm publish` from an agent-run shell dies with `EOTP`.
- **Landed**: the changes being released is on a commit that exists on GitHub.
  `changeset version` resolves `commit:` / `pr:` references against the remote,
  so from an unpushed branch it can only emit a link-free bullet (or refuse —
  see the credit matrix in the decision doc §3). Fix the changeset, not the
  changelog.
- **Version is new**: `npm view <name> version` prints what is already on the
  registry (`0.1.0` since 2026-10-15), and the bump must be above it. A `404`
  returned right after a publish is the CDN's negative cache, not a missing
  release — see "Prove it landed" before believing either answer.

## The runbook

Work on a clean `main`, fast-forwarded over `origin/main`. Run each step and
read its output before the next. Do not do the bump on a `chore/release-*`
branch: `pnpm publish` only runs on `publish-branch` (`master|main` by default,
and this repo has no `.npmrc`), so a branch stops the release on an interactive
prompt after every gate has already passed.

```bash
# 1. Generate the release. GITHUB_TOKEN is what buys PR/commit links and
#    "Thanks [@user]!" credit in CHANGELOG.md.
GITHUB_TOKEN="$(gh auth token)" pnpm changeset version
```

Read `CHANGELOG.md` before continuing. Every line should be a change worth
telling users about. A line with no links and no credit means a changeset
referenced no commit — fix the changeset and redo the step, do not hand-edit
`CHANGELOG.md`.

```bash
# 2. Every gate, against the real artifact. ~25 s, self-cleaning scratch dirs.
pnpm publish:preflight
```

Six gates, all required, all run on the packed tarball installed into a throwaway
project — never on the working tree, which is not what users receive:

| Gate | What it proves | Fail means |
| --- | --- | --- |
| G1 manifest | every entry point ships, MIT license, `prepack` guard, no self-dependency, no dead links in the **packed** README | fix before anything else |
| G2 install | a fresh project installs the tarball | packaging is broken |
| G3 bin | the installed binary prints the packed version | the bin does not work for users |
| G4 public API | `…/plugin` and `…/introspection` import as functions | a public contract is broken — at minimum a major |
| G5 behavior | doctor answers `1` + `SHARED_VERSION_DRIFT` on the drift fixture and `0` on the clean one, **through the installed artifact** | the product does not work as installed |
| G6 reproducibility | two `pnpm pack` runs are byte-identical | the build is not deterministic; the probed artifact is not the published one |

Exit `1` = a gate failed or skipped → **do not publish**. Exit `2` = could not
answer → also do not publish. Never interpret a missing gate as a pass. Use
`--keep` to inspect the scratch tree.

```bash
# 3. Publish. Human, interactive terminal, npm 2FA.
pnpm publish
```

`prepack` rebuilds `dist` automatically. A non-interactive shell fails with
`EOTP` and publishes nothing — do not work around it, hand the command to the
human. There is no `--provenance` on purpose: the registry only accepts
provenance from a CI runner.

## The handoff: ask, then stop

The agent does every step that can be undone and stops before the one that
cannot. An agent **cannot wait**: it must end its turn and stay paused until the
human answers. So the publish is a yes/no question, never a pause, never a
"let me know when you're ready" left hanging mid-tool-call:

1. Run steps 1-2. Report the `CHANGELOG.md` diff, the version transition, and
   the six gate lines verbatim.
2. Ask exactly one question — **"Publish `@callstack/repack-atlas@<v>` now?"**
   with **yes** / **no** — and end the turn.
3. On **no**: stop. Change nothing, revert nothing (the version bump is a normal
   commit they can amend), and record why in the task log.
4. On **yes**: the human runs `pnpm publish` in their own terminal (2FA). Then
   run step 4 yourself and confirm the registry agrees.

`yes` is consent for that one version only. It is not standing permission for
later releases, and it never transfers the 2FA step to the agent.

```bash
# 4. Tag only once the registry agrees.
npm view @callstack/repack-atlas version    # must print the version just published
git tag v<version> && git push && git push --tags
```

### Prove it landed

`npm view <name> version` is the lagging signal: after the first publish the
packument kept answering `404` for about ten minutes while the version URL and
the tarball already answered `200`. The `✅ Published package …` line is not
proof either. Before tagging, or before concluding a publish failed, use the
three signals that do not lag:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://registry.npmjs.org/@callstack%2Frepack-atlas/<version>"
curl -s "https://registry.npmjs.org/-/package/@callstack%2Frepack-atlas/dist-tags"   # {"latest":"<version>"}
cd /tmp && rm -rf probe && mkdir probe && cd probe && npm init -y >/dev/null && npm i @callstack/repack-atlas@<version> && ./node_modules/.bin/repack-atlas --version
```

Compare the downloaded tarball's `shasum -a 256` against your local `pnpm pack`
and the G6 hash: that is what proves users receive the bytes the gates tested.
**Never re-publish a version because a stale `404` said it was missing** — a
version number is burned for good, even after unpublishing.

## Changesets

One file per released change, added in the PR, not at release time:

```markdown
---
"@callstack/repack-atlas": minor
---

add doctor --json output
```

- `patch` fixes · `minor` features · `major` breaking changes to the two public
  subpaths.
- `commit: <full-sha>` or `pr: #<n>` as the first line → links + credit (needs
  `GITHUB_TOKEN`; without it the run refuses rather than shipping a thin
  changelog).
- `author: @user` → credit alone, no API call, works offline.
- A release-only PR (version bump) needs no changeset.

## Never

- Never `npm publish` / `pnpm publish` from an agent-run shell: it cannot
  complete 2FA. Hand the human the exact command.
- Never install or test from a git URL to prove the package works: `dist/` is
  gitignored, so a git install has no code. Test the **tarball**.
- Never add `NPM_TOKEN`, `NODE_AUTH_TOKEN`, or an npm trusted-publisher
  connection: publishing is manual by decision (PRD §13 + the decision doc).
- Never publish from a branch that is not `main`, and never answer your way
  through the `publish-branch` prompt: fast-forward local `main` instead.
- Never treat a `404` from `npm view` as "not published yet" without checking
  the version URL and `dist-tags`: republishing a burned version is
  unrecoverable.
- Never edit `CHANGELOG.md` by hand; regenerate from changesets.
