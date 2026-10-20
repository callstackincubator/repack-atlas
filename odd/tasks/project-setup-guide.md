# Project setup guide (how to instrument your own workspace)

The wiring code ships and works, but it is only visible inside the demo. Someone who
`npm install -D @callstack/repack-atlas` has nowhere to look for what goes into
`rspack.config`. This feature documents it, copying the shapes that already run instead
of inventing them, and lands issue-first behind a PR.

## Specs

- **S1** (user, verbatim): "documentar como instrumentar un proyecto propio. El codigo
  de cableado ya existe y funciona, pero vive solo dentro del demo; quien instala
  @callstack/repack-atlas de npm no tiene donde ver que agregar al rspack.config."
- **S2** (user, verbatim): "FUENTE DE VERDAD (no inventar shapes, copiar de aca):
  <user>/internals/forks/super-app-showcase". Authority
  is the wiring that runs today, not a reconstruction. Confirmed line-accurate on
  `origin/atlas-demo-scoped-names`: `packages/host/rspack.config.ts` :5-6 imports, :102
  `FederationManifestPlugin`, :109 `IntrospectionPlugin`; `packages/auth/rspack.config.ts`
  :4-5 imports, :75, :83. `origin/atlas-demo` carries the same blocks at the same lines
  with the unscoped key and "sirve para contrastar, no como ejemplo de la guia."
- **S3** (user, verbatim): the real observed difference to document: "host pasa {name,
  manifest:true, writeToDisk:true, shared, remotes}; un remote agrega exposes y
  filename; IntrospectionPlugin lleva role, exposes: [] en host vs Object.keys(exposes)
  en remote, port y native {reactNativeVersion, newArch, platforms}".
- **S4** (user, verbatim): "Proceso, issue-first (pr-checks exige Closes/Refs #N en el
  body)" with these steps: gh issue create "docs: show the plugin wiring for an
  npm-installed project" with verifiable "Done when"; branch `docs/project-setup-guide`
  from `main`; create `docs/setup-your-project.md`; README "Your own workspace" pointer
  of 2-3 lines.
- **S5** (user, verbatim): the guide's required content: "prequisito explicito:
  workspace Re.Pack 5 con Module Federation ya funcionando (link a https://re-pack.dev
  para ese lado). Atlas verifica la federacion, no la crea." Then "pasos para un proyecto
  con npm install -D @callstack/repack-atlas (NO el file: del demo): imports a
  @callstack/repack-atlas/plugin y @callstack/repack-atlas/introspection en el
  rspack.config de CADA app, los dos plugins junto a ModuleFederationPluginV2 pasando el
  MISMO objeto shared/remotes/exposes; buildear una vez para que existan los manifests;
  npx repack-atlas init --workspace <ws>; despues doctor."
- **S6** (user, verbatim): "nota honesta, medida: sin instrumentacion, init y doctor
  responden 'could not answer' con exit 2. No es un bug de Atlas." Measured, and
  corrected against the tool before writing: `doctor` exits `2` with
  `UNABLE_TO_ANSWER`; `init` exits `0` (see Log L2). The guide documents what was
  observed, not the paraphrase.
- **S7** (user, verbatim): "mencionar que init escribe el repack-federation.json y que
  los manifests quedan por app (en el demo: packages/<app>/repack-federation-manifest.json)."
- **S8** (user, verbatim): "TODO link del README a docs/ debe ser URL completa
  https://github.com/callstackincubator/repack-atlas/blob/main/docs/...: el tarball no
  incluye docs/ y la regla dead-link de check:publish rompe el publish si linkeas
  relativo." Confirmed in `scripts/publish-check.mjs:129-151` (`readmeDeadLinks`, rule
  `dead-link`); it only scans `README.md`, so a relative link inside `docs/` is allowed.
- **S9** (user, verbatim): "Prosa English, ASCII-only (human-prose regla 1; scan con
  python, grep -P no existe en BSD). Sin referencias internas, el repo es publico."
- **S10** (user, verbatim): "Gates antes de PR: pnpm check:publish (lee el README
  empaquetado, la que importa aca), agent:check, typecheck, lint, test. Conventional
  Commits sin Co-Authored-By. PR body con 'Refs #<issue>'. Review de agente antes de
  humano. No mergear sin que yo lo diga."
- **S11** (user, verbatim): "Entrada de Log al final de odd/tasks/ (doc nuevo o el mas
  cercano), ASCII-only, sin IDs internos." No Notion links, ticket IDs or colleague
  names anywhere in this public repo.
- **S12** (user, verbatim): "Chequea el tema de la PR #1 cuando la abras: sigue abierta
  y atlas-demo (base) usa repack-atlas/plugin sin scope, autoconsistente, asi que el
  demo anda igual. Si la mergeas antes, la guia puede linkear el main del showcase en
  vez de una rama." Confirmed at start of this session: showcase-fork PR #1 `OPEN`
  (`atlas-demo-scoped-names` -> `atlas-demo`), not merged. Do not merge it; the guide
  must not depend on a branch that may move.

## Tasks

- **T1** - `docs/setup-your-project.md`: prerequisite, install, host and remote wiring, build once, `init`, `doctor`, manifest-ref edit, exit-code note, `schemaVersion`. Route: delegated writer (measured context backstop, not size). Specs S2-S8. Commit `825bdad`.
- **T2** - README "Your own workspace" pointer, absolute GitHub URL, same slice as T1 (one behavior, one unit). Specs S4, S8. Commit `825bdad`.
- **T3** - Gates observed: `typecheck`, `lint`, `test` (985 pass), `check:publish`, `agent:check`, `check:specifiers`, ASCII scan. Specs S9, S10. Evidence in L5.
- **T4** - Issue #82, branch, two work-unit commits, agent review, PR body `Refs #82`, no merge without the owner. Specs S4, S10, S11, S12.

## Log

- **L1** (user, verbatim, opening request): "Eso mejora el prompt de forma importante:
  no hay que escribir el snippet desde src/repack-bridge, hay que copiar el que ya
  corre." Followed by the source-of-truth listing (host :7-8/:102/:109, auth :75/:83 on
  `origin/atlas-demo`, same lines with `@callstack/repack-atlas/...` on
  `origin/atlas-demo-scoped-names`, root `repack-federation.json` with host + 3 remotes),
  the updated prompt block (issue-first process, guide content, README absolute link,
  ASCII-only English prose, gates, Log entry) and the closing instruction to check the
  state of PR #1 before opening ours.
- **L2** (parent, measured on `main` @ d58afe4 with `dist/cli.js` against a throwaway
  two-app workspace in `mktemp -d`, no instrumentation): `init --workspace <ws>` exits
  **0**, discovers both apps as `facts: directory-name`, and writes
  `repack-federation.json` with `manifest: manifests/<app>.json` plus `root`, no `port`.
  `doctor --workspace <ws>` exits **2** with
  `UNABLE_TO_ANSWER [static] Host manifest could not be used: No manifest found at
  .../manifests/host.json.` So the honest note is: `init` answers (exit 0) and writes a
  config pointing at manifests that do not exist yet; `doctor` is the one that cannot
  answer (exit 2). S6 records the correction rather than repeating the paraphrase.
- **L3** (parent, measured + read): two facts the demo hides. (a) `.repack-atlas/introspection.json`
  without `schemaVersion: 1` is rejected silently: `init` prints `facts: directory-name`
  and drops `port`; with `schemaVersion: 1` it prints `facts: introspection, port 8081`
  (`src/core/introspection-types.ts:82`, `src/cli/init.ts:364-384`). (b) `init` writes
  the ref `manifests/<app>.json`, while `writeToDisk: true` writes
  `<appRoot>/repack-federation-manifest.json` (`plugin.ts:117-121`,
  `DEFAULT_MANIFEST_FILENAME` in `vendored/federationManifest/types.ts:11`). The two do
  not meet: `doctor` still exits 2 after a build until the ref is edited, which is why
  the showcase config is hand-authored (`docs/demo-showcase.md:133-136`). The guide must
  show that edit, not pretend `init` output is final.
- **L4** (parent, verified): `docs/` is not in `files` (`package.json` ships `dist` only)
  and `readmeDeadLinks` scans `README.md` only, so guide-to-guide relative links are
  fine and a README-to-docs relative link is not. PR #1 still `OPEN`; the showcase
  remote for this work is a public fork of `callstack/super-app-showcase`.
- **L5** (parent, after T1/T2): the writer produced `docs/setup-your-project.md` and the
  README pointer. Parent verification, not the writer's word: every cited value was
  re-checked against `git show origin/atlas-demo-scoped-names:...` (host `remotes` :21-25,
  `shared` :26 `getSharedDependencies({eager: true})`, MF2 :96-101, manifest plugin :102-108,
  introspection :109-121; auth `exposes` :20-24, `eager: false` :25, `filename` :70, :75-82,
  :83-95), the guide is 0 non-ASCII lines, the README diff adds 0 non-ASCII lines, and
  `docs/PRD.md` 8.2 does say what the guide attributes to it. Restored one nuance the
  writer dropped: subpaths are public API *under semver*, which the README paragraph said
  and PRD 8.2 confirms. Gates observed on this branch: `typecheck` 0, `lint` 0, `test` 0
  (985 pass, 0 fail), `check:publish` 0 (247 packaged files, README dead-link rule
  included), `agent:check` 0, `check:specifiers` 0 with the guide staged (333 files; the
  same run cannot see an untracked file, so staging it is what gives the check signal).
  Pre-existing, out of scope, follow-up candidate: `README.md` carries 17 non-ASCII lines
  on `main` (em dash, `->`, `x`, section sign), so an "ASCII scan over README prints
  nothing" gate is unsatisfiable without a separate authorized sweep, and no CI script
  enforces ASCII anyway. S6 correction stands as written in L2: `init` answers with exit
  0, `doctor` is the one that cannot answer.
- **L5b** (pre-commit scan): `odd/` is tracked and this repo publishes, so by the
  `npm-publish-readiness` precedent this doc carries no ticket IDs beyond the public issue
  number, no Notion/Slack links and no colleague names; the personal path in S2 is elided
  to `<user>/internals/forks`, bending the verbatim rule in that one spot on purpose.

- **L6** (parent, incident on our side, recorded so it is not repeated): during the L2/L3
  measurements one command read `WS` from a scratch file that an earlier `set -e` death
  had prevented it from writing. `WS` expanded empty, `cd ""` failed without aborting the
  script, and the fixture `mkdir`/`cat >` landed inside the repo as untracked
  `packages/{host,auth}/.repack-atlas/introspection.json`. Caught from `git status
  --porcelain` while reviewing the writer's diff, confirmed by content (the two fake
  documents, no `schemaVersion`), and moved to `/tmp/atlas-stray-quarantine/packages-stray`
  rather than deleted; nothing tracked was touched. Guard: write fixtures only through an
  absolute path echoed in the same command, never a variable sourced from a file that
  might not exist.
