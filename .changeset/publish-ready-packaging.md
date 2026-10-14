---
"@callstack/repack-atlas": minor
---

Make the package publishable: drop the dangling root entry (`main`/`types` pointed at a `dist/index.js` that `tsc` never emitted), declare `repository`/`bugs`/`homepage`, and rebuild `dist` on `prepack` so a publish can never ship a stale tree. `pnpm check:publish` now guards the manifest and the packaged entry points.
