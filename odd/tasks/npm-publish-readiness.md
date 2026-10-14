# npm publish readiness (local, proposal-first)

Make `repack-atlas` publishable by copying the release playbook already proven in
Re.Pack, and stop right before anything leaves the machine. Nothing here is
committed, pushed, tagged or published; the npm name stays undecided on purpose.

## Specs

- **S1** (user, verbatim): "en repack habiamos creado unos pasos a seguir para
  publicar a npm". Authority for the mechanics is therefore Re.Pack's own
  playbook, not an invention: `repack/CONTRIBUTING.md` §Publishing a release
  (changesets + `changesets/action`, "Releases use npm trusted publishing
  instead of long-lived npm automation tokens. Do not add `NPM_TOKEN` or
  `NODE_AUTH_TOKEN` secrets for publishing.") and
  `repack/.github/workflows/release.yml` (`stable-release` on push to `main`,
  `canary-release` on `workflow_dispatch` from `main`, `permissions:
  contents: write / id-token: write / pull-requests: write`, actions pinned by
  SHA, `pnpm release` = `pnpm changeset publish`).
- **S2** (user, verbatim): "entiendo lo de la primera tabla que hay que hacer si
  o si". The mechanical half of the five decisions from the conversation is done
  here: packaging manifest, changesets, release workflow, CI guard, docs.
- **S3** (user, verbatim): "crea lo que quieras que tengamos que hacer pero solo
  local y que no se suba a ningun lado por ahora". Hard boundary: no commit, no
  push, no tag, no `pnpm publish`, no npmjs.com mutation. Everything stays in the
  working tree of `feat/npm-publish-readiness` for review.
- **S4** The npm **name stays open**. The survey of the org's 48 incubator repos
  records the convention: "npm unscoped or `@callstack/` (never
  `@callstackincubator/`)". So the earlier recommendation of
  `@callstackincubator/repack-atlas` is withdrawn, and no artifact hardcodes a
  rename: `package.json` keeps `repack-atlas`, and the manifest checker must not
  assert a scope.
- **S5** The checker must be honest about packaging rules. Verified empirically,
  not guessed: `pnpm pack` + `npm install ./repack-atlas-0.0.1.tgz` in a clean
  project proved `README.md` and `LICENSE` ship even with `files: ["dist"]`, and
  proved `import('repack-atlas')` fails with `ERR_MODULE_NOT_FOUND` because
  `main`/`types` point at a `dist/index.js` that `tsc` never emits.

## Non-goals

No npm account/trusted-publisher configuration (that is a website action, and it
starts a 2-day expiry clock — see the decision doc). No version bump. No
CHANGELOG. No rename. No `1.0.0`. No CI publish run. No push.

## Tasks

- [x] T1 Feature doc + memory mirror — no commit.
- [x] T2 RED→GREEN: `scripts/publish-check.mjs` + `scripts/publish-check.d.mts`
      + `tests/scripts/publish-check.test.ts` (17 tests). RED showed 6 violations
      / 3 root causes; the repo itself is one of the fixtures. Four more holes
      found by independent verification were closed test-first (L11).
- [x] T3 `package.json`: dropped the dangling root entry (`main`, `types`, the
      `"."` export), added `repository`/`bugs`/`homepage`/`keywords`, `prepack`,
      `publishConfig.registry`, `check:publish` script.
- [x] T4 Changesets wired **locally, run by hand** (T5 dropped): `.changeset/config.json`,
      devDeps `@changesets/cli@2.31.1` + `@changesets/changelog-github@0.7.0`,
      `pnpm-workspace.yaml` gains `- "."` (without it changesets refuses:
      "changeset … not in the workspace"), one starter changeset.
- [x] T5 ~~release.yml~~ **DROPPED by owner decision 2026-10-14**: publishing is
      manual. No workflow, no `changesets/action`, no npm token, no trusted
      publisher. See Log L7.
- [x] T6 Docs: `CONTRIBUTING.md` §Publishing to npm + §Add a changeset, CI-step
      table row, `AGENTS.md` Setup + CI sentence, `README.md` install note
      rewritten (git install removed as invalid), `docs/PRD.md` §13 annotated.
- [x] T7 `docs/decisions/npm-publish.md`: decided vs open, the 4-cell changelog
      behaviour table, the 6-violation evidence, the provenance trade-off.
      Plus `.agents/skills/atlas-npm-publish/SKILL.md` + `pnpm agent:sync`
      (6 skills in sync) so "voy a publicar" is one invocable runbook.
- [x] T8 Verification, observed output in Log L8.
- [x] T9 npm name decided: `@callstack/repack-atlas` (L12). Applied to
      `package.json`, the changeset key, `CONTRIBUTING.md` and the skill; the
      `repack-atlas` **binary** name is unchanged, and the GitHub org stays
      `callstackincubator`.
- [x] T10 `scripts/publish-preflight.mjs` + `tests/scripts/publish-preflight.test.ts`
      (5 tests) + `pnpm publish:preflight`: six gates on the **installed** tarball
      (G1 manifest, G2 install, G3 bin, G4 public API, G5 doctor behavior, G6
      reproducible pack). Test-first: RED from two real bugs in the first draft
      (`dirname` imported from `node:url`, duplicate `node:path` import), then
      G1 refactored pure after RED showed it doing I/O.

## Commit split — LANDED 2026-10-14 (owner: "Commits + PR primero")

Landed as 6 units, not the 5 proposed above: `publish:preflight` (T10) arrived
after that split was written, and it is its own work unit. Line counts are
`additions + deletions` excluding `pnpm-lock.yaml` — the same measure the
`400-line review budget` CI check uses.

| # | commit | lines | subject |
| --- | --- | --- | --- |
| 1 | `5766e22` | 27 | `fix(package): drop the dangling root entry and declare repository metadata` |
| 2 | `3df1c50` | 757 | `feat(release): add changesets configuration and the publish manifest guard` |
| 3 | `0f6aef4` | 7 | `ci(release): gate the publish manifest on every PR` |
| 4 | `0e9401b` | 471 | `feat(release): add the publish preflight gates for the installed tarball` |
| 5 | `57e2c93` | 330 | `docs(release): document manual publishing and record the open decisions` |
| 6 | `983e2c0` | 162 | `docs(skills): add the atlas-npm-publish runbook skill` |

Each commit is self-consistent: `package.json` and the generated `AGENTS.md`
tables were staged progressively so `pnpm agent:check` and `check:publish` pass
at every commit, not just at the tip.

## Log

- **L1** (user, verbatim): "en repack habiamos creado unos pasos a seguir para
  publicar a npm, entiendo lo de la primera tabla que hay que hacer si o si, pero
  ahi tenemos cosas tamnbien no? crea lo que quieras que tengamos que hacer pero
  solo local y que no se suba a ningun lado por ahora"
- **L2** Prior turn: "no quiero hacerlo, quiero hablar y planear para proponer,
  como seria subirlo a npm?" — the mode is proposal, not delivery. This is why
  T2–T8 stop at the working tree and why the name decision is left open.
- **L3** (self-correction, evidence): the claim "README.md does not ship in the
  pnpm tarball" was false, produced by a broken regex against
  `--dry-run` chrome. Re-checked by installing the real tarball: `README.md`
  (13.2 kB) and `LICENSE` are present. Lesson recorded: install the tarball, do
  not pattern-match a dry-run listing. The neighbouring claim (`main` → a missing
  `dist/index.js`) is real and was proven by an import failing.
- **L4** (evidence, scope): the incubator convention from the repo survey is
  unscoped-or-`@callstack/`; `@callstackincubator/…` is off-convention. npm
  registry probed 2026-10-14: `repack-atlas`, `@callstack/repack-atlas`,
  `repack-doctor`, `repack-studio`, `federation-atlas` → all 404 (free);
  `react-native-atlas` → taken, dead since 2022. Name decision stays open.
- **L5** (evidence, parity): Re.Pack ships `@callstack/repack@5.3.0` with
  `files` listing `dist` plus native dirs, `publishConfig: { registry,
  access: public }`, `repository.url` present, and **no** `prepack` (its build
  runs as an explicit CI step before `changesets/action`). Atlas has no build
  daemon and a gitignored `dist/`, so Atlas adds `prepack` as the stale-dist
  guard; that is the one deliberate divergence from S1 and T2 pins it.
- **L6** (decision, local-only): per the working-mode in L2, no git commit is
  made even though ODD normally lands a work-unit commit per task. The commit
  split is recorded in "Proposed commit split" below so the human can ask for it
  in one line. This is an explicit deviation, not an oversight.
- **L7** (user, verbatim): "I will publish manually" (after "but I won't do that
  at least for now, no need" about the automated release PR). Drops Re.Pack's
  `release.yml`/`changesets/action` shape and the npmjs trusted-publisher setup.
  Brownfield's PR #486 stays useful for what it actually documents: the manual
  first-publish gotchas (`EOTP` in a non-interactive shell, the `0.0.0-stage`
  placeholder, a published version never being reusable).
- **L8** (evidence, verification, 2026-10-14, all observed):
  `typecheck` exit 0 · `lint` exit 0 · `test` **948/948 pass** ·
  `check:publish` → `publish-check: OK - repack-atlas@0.0.1 with 247 packaged
  file(s), 3 workflow(s) checked` · `check:vendored` → OK, 6 files ·
  `agent:check` → OK, 6 skills · `pnpm install --frozen-lockfile` clean ·
  `changeset status` resolves a sane release plan. `pnpm publish --dry-run` runs
  `prepack` (`tsc`) and rebuilds `dist` from scratch (verified by deleting it).
- **L9** (evidence, changelog credit — what the owner asked for): four probes
  against the real repo. `commit: <pushed sha>` + `GITHUB_TOKEN` (40-char
  `gh auth token`, no PAT minted) →
  `- [#76](…/pull/76) [`83045ae`](…commit…) Thanks [@gedu](https://github.com/gedu)! - …`.
  Same changeset without the token → refuses with "Please create a GitHub
  personal access token…" and applies nothing. Plain changeset without a token
  → ships a line with no links and no credit. `author: @user` → credit with no
  API call. Requirement satisfied and versioned in git as `CHANGELOG.md`.
- **L10** (self-correction, second one this session): wrote `pnpm publish
  --provenance` into CONTRIBUTING for a manual publish, then npm's own docs
  contradict it — provenance requires a GitHub Actions/GitLab **cloud runner**
  with `id-token: write`. A manual publish can never carry provenance. Fixed the
  runbook to say so and recorded the trade-off in the decision doc §5. Also: a
  task was marked done before its artifact (the skill) existed; caught and
  corrected the same session.
- **L11** (independent verification, ASSESS returned risk `unassessable` → high,
  so `gentle-ai-verify` ran read-only). Verdict: mechanics sound, S3 PASS
  (0 commits, 0 tags, registry still 404, only two `npm publish --dry-run` in
  the npm logs). It found, and each was fixed with its own test or edit:
  1. **The guard passed vacuously four ways**: `--no-pack` skipped every
     manifest rule and could only report OK (flag removed, unknown args → exit
     2); a self-dependency from a stray `pnpm link` shipped unnoticed
     (`self-dependency`); `changesets/action` + a custom publish script hid an
     `NPM_TOKEN` (regex widened); the published README linked `docs/…` and the
     demo GIF, which 404 on npmjs.com (`dead-link`, reading the README **as
     packed** — it found 3 real hits, now absolute URLs).
  2. **Docs instructions that fail when followed**: `pnpm link --global` is
     rejected by pnpm 11 (README → `pnpm link <absolute-path>` from the
     consumer); `pnpm pack` in a scratch dir errors (CONTRIBUTING → run it in
     the repo, absolute paths); the doctor probe from a scratch dir answers 2,
     not 1 (CONTRIBUTING → absolute `--workspace`); `*.tgz` was not gitignored
     while prose said never commit it (added to `.gitignore`); the CI table said
     274 tests.
  3. **A claim I could not support**: git-install broken was proven on a probe
     clone that had added `prepare: tsc`. Re-proven honestly against `HEAD`
     (clean clone, `prepare` absent, `dist/` absent from the tree) and against
     the GitHub URL; the "would `prepare` fix it?" question is explicitly
     marked unverified in the decision doc rather than asserted.
  4. **Repository mutated under the verifier's own authorization**: its
     `pnpm link --global .` **inside the repo** wrote
     `"repack-atlas": "link:"` into `dependencies`, an `overrides:` block into
     `pnpm-workspace.yaml` and `pnpm-lock.yaml`, and a `node_modules/repack-atlas`
     self-link — and `check:publish` reported OK on the poisoned tree. Reverted
     by hand (`git checkout` was rejected: the lockfile also holds the changesets
     entries); the rule from L11.1 now catches exactly this. Poison test: 3
     violations + exit 1, and `package.json` restored byte-identical
     (`18899a7b…`).
  Final observed state: `typecheck` 0 · `lint` 0 · **test 951/951** ·
  `check:publish` OK · `check:vendored` OK · `agent:check` OK · 0 commits, 0
  tags. Independent confirmation that `super-app-showcase` consumes only the two
  shipped subpaths, so dropping the root entry breaks no external consumer.
- **L12** (user, verbatim): "creo que lo mejor es usar @callstack/ no? asi
  seguimos eso". Name resolved. Verified before writing it down:
  `@callstack/repack-atlas` free (404); the user is one of 19 maintainers of
  `@callstack/apex` as `eduardogracianock`; but `npm whoami` → **E401**, this
  machine is not logged into npm — the one remaining setup step, and it is
  interactive (`npm login` + 2FA, human). Scope applied to the manifest, the
  changeset key, CONTRIBUTING and the skill; bin stays `repack-atlas`, GitHub org
  stays `callstackincubator`. Consequence noted, not fixed here:
  `super-app-showcase` uses `repack-atlas/plugin` in 4 `rspack.config.ts` and
  `"repack-atlas": "file:…"` in 4 `package.json` — that demo branch moves to the
  scoped specifier at publish time.
- **L13** (user, verbatim): "me encanta que si bien es manual el publish a npm yo
  te lo pueda pedir a vos, y vos hagas todos los pasos… tenes skills para eso?
  para saber que se tiene que probar al momento de que se va a hacer publish?
  tengamos eso estructurado" + the yes/no abort protocol. Answered with code, not
  prose: the manual probes this session did by hand became `publish:preflight`
  (G1-G6, exit 1/2 both mean "do not publish"), and the skill gained a "The
  handoff: ask, then stop" section stating that an agent **cannot wait** — it
  ends its turn with one yes/no question and stays paused; `yes` authorizes that
  one version only and never transfers the 2FA step.
- **L14** (verification, 2026-10-14, observed): preflight end-to-end twice, 6/6
  PASS in ~25 s; second run after the README/skill edits, hash changed
  (`10efa20d…` → `6cca66a7…`) which is exactly what G6 is for. Suite 956/956
  (+5 preflight tests, +1 from the rename round). `typecheck` 0, `lint` 0,
  `check:publish` OK, `check:vendored` OK, `agent:check` OK (6 skills),
  `changeset status` OK. Local-only invariants held throughout: 0 commits ahead,
  0 tags, registry still 404 for the scoped name.
- **L15** (user, verbatim): "hacemos 0.1.0 para el primer publish, y ya funca:
  npm whoami → eduardogracianock". First version and login both closed; recorded
  as decisions 7 and 8 in the decision doc, and the runbook/skill precondition
  text updated to match. Re-checked authenticated, all observed: `npm whoami` →
  `eduardogracianock`; `npm profile get` → TFA mode `auth-and-writes` (so every
  publish needs a fresh OTP and an agent-run shell cannot do it); `npm view
  @callstack/repack-atlas version` → still 404; `npm access list packages
  @callstack` → `read-write` on 62 packages incl. `@callstack/repack` and
  `@callstack/apex`. Honest limit kept in the doc: write access to existing
  scoped packages does **not** prove the ability to claim a new name under the
  scope — only the publish itself does, and a rejected publish leaves nothing.
- **L16** (evidence, sequencing blocker for step 1 of the runbook). The credit
  lines the owner asked for need a changeset that names a **pushed** commit or
  PR. Today the whole change is uncommitted (`0` commits ahead, branch not on
  `origin`), so `changeset version` now can only write a link-free bullet.
  `pnpm changeset status` confirms the version plan itself is right: exactly one
  minor bump, `@callstack/repack-atlas` → `0.1.0`, no other package. So the
  publish order is: land + push (owner's call) → changeset gains `pr: #<n>` →
  `changeset version` → preflight → the yes/no. Re-verified docs-only edits:
  `agent:check` OK (6 skills), `typecheck` 0, `lint` 0, **test 956/956**,
  `check:publish` OK. Local-only invariants still hold: 0 commits ahead, 0 tags,
  registry 404, no `npm publish`, no `npm login`, no npm account mutation.
- **L17** (evidence, landing + the review-size truth). Owner chose "Commits + PR
  primero"; the 6 units above landed on `feat/npm-publish-readiness` and
  `pnpm check:commits` → `OK - 6 item(s) checked`.
  **The "~200 line" figure in obs 926 was wrong**: it measured only the
  already-tracked modifications. The real PR diff, counting the new files CI
  counts, is **1754** lines excluding `pnpm-lock.yaml` — over the 400 budget, so
  the PR carries `size:exception` (precedent: PRs 66, 68, 74 all carry it; I have
  `admin` on the repo). Slicing further would split a guard from its own tests,
  which the budget exists to prevent, not cause.
  Also fixed while staging: an orphan code fence in the skill's runbook (line 72)
  that made steps 1-2 render as one block.
  Pre-existing flake found while verifying the tip: `pnpm test` failed on run 1
  of 6 and on run 5 of 6, in
  `tests/runner/dev-runner.test.ts` › `without --platform nothing is forwarded
  and the env var stays unset`, hanging **725 s** on `timeout waiting for app
  other status ready` instead of failing at its 15 s deadline. My diff touches no
  `src/` and no runner test (that file is byte-identical to `origin/main`), so it
  is not introduced here; filed as **#77** with the reproduction loop and the
  unref-timer hypothesis. Other observed at the tip: `typecheck` 0 · `lint` 0 ·
  `agent:check` OK (6 skills) · `check:vendored` OK · `check:publish` OK ·
  `pnpm test` 956/956 on the passing runs.
  Tracking: **#78** is the publish issue (this PR links it); **#77** is the
  flake. `odd/tasks/` is tracked in this repo by precedent (`docs(odd):` commits),
  and this doc was scanned for internal references before committing: no ticket
  IDs, no Notion/Slack links, no memory-tool references.
