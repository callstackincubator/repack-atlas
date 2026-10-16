---
"@callstack/repack-atlas": patch
---

pr: #81

`doctor` now names the published scoped plugin subpath in its
missing-introspection message and in the config example, instead of the
pre-rename spelling that pointed at a package name which is not on the
registry. Adds `pnpm check:specifiers`, a CI guard that fails if that spelling
reappears anywhere in the tracked tree.
