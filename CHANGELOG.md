# @callstack/repack-atlas

## 0.1.0

### Minor Changes

- [#79](https://github.com/callstackincubator/repack-atlas/pull/79) [`b02ad27`](https://github.com/callstackincubator/repack-atlas/commit/b02ad2710403ce7221a805d10f2e6dac198c9739) Thanks [@gedu](https://github.com/gedu)! - Make the package publishable: drop the dangling root entry (`main`/`types` pointed at a `dist/index.js` that `tsc` never emitted), declare `repository`/`bugs`/`homepage`, and rebuild `dist` on `prepack` so a publish can never ship a stale tree. `pnpm check:publish` now guards the manifest and the packaged entry points.
