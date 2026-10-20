# Instrument your own workspace

Atlas is a reader. It looks at two artifacts a build produces, a federation
manifest per app and a workspace config, and answers questions about them. To
get those artifacts into a project of your own you add two plugins to each
app's Rspack config, build once, and run `init` then `doctor`. Every option
shape below is copied from a workspace where this wiring runs today, not
written from the plugin source.

## Prerequisite

You need a [Re.Pack](https://re-pack.dev) 5 workspace with Module Federation
already working: a host that declares remotes, mini-apps that expose modules,
and `shared` dependencies that resolve at runtime. Atlas verifies that setup, it
does not create it. If federation does not work yet, fix it with the Re.Pack
docs first. The [demo walkthrough](./demo-showcase.md) shows what Atlas does
with a workspace where the wiring is already in.

## Install

Atlas is a dev tool, so keep it a devDependency of the workspace:

```bash
npm install -D @callstack/repack-atlas
npx repack-atlas --version
```

That is the whole install. The demo workspace in this repo reaches Atlas
through a `file:` dependency into a local clone instead, which is a contributor
convenience and not what your project should do. `@callstack/repack` is a peer
dependency resolved from your app, so Atlas never bundles Re.Pack.

## Add the two plugins to every app

Both plugins go in **every** app's `rspack.config.ts`, in the same `plugins`
array as `Repack.plugins.ModuleFederationPluginV2`, and they take the *same*
`shared`, `remotes` and `exposes` objects you already pass to that plugin.
Build the objects once at the top of the config and hand the same reference to
all three plugins; keeping them in sync by hand is how drift gets in.

Host:

```ts
import * as Repack from '@callstack/repack';
import { FederationManifestPlugin } from '@callstack/repack-atlas/plugin';
import { IntrospectionPlugin } from '@callstack/repack-atlas/introspection';

export default Repack.defineRspackConfig(({ mode, platform }) => {
  const remotes = {
    auth: `auth@http://localhost:9003/${platform}/mf-manifest.json`,
    trading: `trading@http://localhost:9001/${platform}/mf-manifest.json`,
    wallet: `wallet@http://localhost:9002/${platform}/mf-manifest.json`,
  };
  const shared = getSharedDependencies({ eager: true });

  return {
    // ...your existing entry, resolve, module and output config
    plugins: [
      new Repack.RepackPlugin(),
      new Repack.plugins.ModuleFederationPluginV2({
        name: 'host',
        dts: false,
        remotes,
        shared,
      }),
      new FederationManifestPlugin({
        name: 'host',
        manifest: true,
        writeToDisk: true,
        shared,
        remotes,
      }),
      new IntrospectionPlugin({
        name: 'host',
        role: 'host',
        exposes: [],
        remotes,
        shared,
        port: 8081,
        native: {
          reactNativeVersion: '0.86.2',
          newArch: true,
          platforms: ['ios', 'android'],
        },
      }),
    ],
  };
});
```

Remote (the `auth` mini-app):

```ts
import * as Repack from '@callstack/repack';
import { FederationManifestPlugin } from '@callstack/repack-atlas/plugin';
import { IntrospectionPlugin } from '@callstack/repack-atlas/introspection';

export default Repack.defineRspackConfig(({ mode }) => {
  const exposes = {
    './AccountScreen': './src/screens/AccountScreen',
    './SignInScreen': './src/screens/SignInScreen',
    './AuthProvider': './src/providers/AuthProvider',
  };
  const shared = getSharedDependencies({ eager: false });

  return {
    // ...your existing entry, resolve, module and output config
    plugins: [
      new Repack.RepackPlugin(),
      new Repack.plugins.ModuleFederationPluginV2({
        name: 'auth',
        filename: 'auth.container.js.bundle',
        dts: false,
        exposes,
        shared,
      }),
      new FederationManifestPlugin({
        name: 'auth',
        manifest: true,
        writeToDisk: true,
        shared,
        exposes,
        filename: 'auth.container.js.bundle',
      }),
      new IntrospectionPlugin({
        name: 'auth',
        role: 'remote',
        exposes: Object.keys(exposes),
        remotes: {},
        shared,
        port: 9003,
        native: {
          reactNativeVersion: '0.86.2',
          newArch: true,
          platforms: ['ios', 'android'],
        },
      }),
    ],
  };
});
```

Both snippets drop the unrelated plugins, loaders and `ignoreWarnings` entries
those apps carry; the Atlas options and the values inside them are the ones in
use. `getSharedDependencies` is that workspace's own helper for its shared set:
substitute whatever your config already hands to `ModuleFederationPluginV2`.

What differs between the two roles:

- `FederationManifestPlugin` on the host takes `{ name, manifest: true,
  writeToDisk: true, shared, remotes }`. A remote adds `exposes` and the
  container `filename` instead of `remotes`, so the manifest records what it
  serves and under what bundle name.
- `IntrospectionPlugin` takes `name`, `role` (`host` or `remote`), `exposes` as
  an empty array on the host and `Object.keys(exposes)` on a remote, `remotes`,
  `shared`, `port`, and a `native` block with `reactNativeVersion`, `newArch`
  and `platforms`. The ports above are the real ones: 8081 for the host, 9003
  for `auth`, with 9001 and 9002 for the other two mini-apps.

Both plugins are opt-in: nothing is emitted until you add them. Both subpaths
are Atlas public API under semver, and Re.Pack / Module Federation
compatibility is validated here rather than upstream (`docs/PRD.md`
section 8.2).

## Build once, then init and doctor

The manifest is a build artifact, so run your normal build once per app before
`init` looks around. Then:

```bash
npx repack-atlas init --workspace /path/to/workspace
npx repack-atlas doctor --workspace /path/to/workspace
```

## What `init` writes

`init` writes `repack-federation.json` at the workspace root: a `host` entry
plus a `remotes` entry per discovered app, each with the `manifest` ref, the
app `root`, and a `port` when it found one. The manifests themselves are
per-app and land in the app directory, since `writeToDisk: true` writes them to
the Rspack `context`: `<appRoot>/repack-federation-manifest.json`. In the demo
workspace that is `packages/<app>/repack-federation-manifest.json`.

## Then edit the manifest refs

`init` and `writeToDisk` disagree about where a manifest lives, and this is the
step that decides whether `doctor` can answer. `init` emits the ref
`manifests/<app>.json`, relative to the workspace root. The plugin writes
`<appRoot>/repack-federation-manifest.json`. Nothing puts the file where the
config points, so a build that succeeds still leaves `doctor` exiting `2` until
you point the refs at the files.

Open `repack-federation.json` and rewrite each `manifest` to the path the
plugin actually used:

```diff
 {
   "host": {
-    "manifest": "manifests/host.json",
+    "manifest": "packages/host/repack-federation-manifest.json",
     "root": "packages/host",
     "port": 8081
   },
   "remotes": {
     "auth": {
-      "manifest": "manifests/auth.json",
+      "manifest": "packages/auth/repack-federation-manifest.json",
       "root": "packages/auth",
       "port": 9003
     }
   }
 }
```

Same edit for every remote, one line each. This is why the demo workspace keeps
a hand-written `repack-federation.json` rather than generating it. Treat the
`init` file as a first draft: the discovered apps and ports are useful, the
manifest refs are not final.

## `doctor` exiting 2 with nothing instrumented is honest

The other way to meet an exit `2` is to have nothing to read. On a two-app
workspace with no plugins wired and no manifests, measured against a build of
`main`:

- `init` exits `0`. It discovers both apps from their directory names, prints
  `facts: directory-name` for each, and writes `repack-federation.json` with
  `manifest` and `root` and no `port`, because it was never told one.
- `doctor` exits `2`:

  ```
  UNABLE_TO_ANSWER [static] Host manifest could not be used: No manifest found at .../manifests/host.json.
  ```

That is Atlas refusing to guess, which is the correct answer: it checked
nothing, so it cannot say the federation is fine. Exit codes are a contract:
`0` clean (warnings allowed), `1` ran and found errors, `2` could not answer.
An uninstrumented workspace belongs in the third bucket, and a bug there would
look like a green run over empty data.

## The introspection file and `schemaVersion`

`IntrospectionPlugin` also writes `<appRoot>/.repack-atlas/introspection.json`,
and `init` reads it when present. It is strict about the shape: a document
without `schemaVersion: 1` is rejected with no warning, and that app falls back
to directory-name discovery. So `init` prints `facts: directory-name` and drops
the port. With `schemaVersion: 1` in the file the same run prints `facts:
introspection, port 8081` and carries the port into the config.

If `init` reports `facts: directory-name` for an app you know you wired, check
that the file exists and starts with `"schemaVersion": 1` before you look
anywhere else.
