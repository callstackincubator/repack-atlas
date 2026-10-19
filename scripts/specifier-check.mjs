#!/usr/bin/env node
/**
 * specifier-check — CI guard for the published import specifier (#80).
 *
 * The package is `@callstack/repack-atlas` since 0.1.0, so the two public
 * subpaths are `@callstack/repack-atlas/plugin` and `.../introspection`. The
 * unscoped spelling predates the rename, and it is not a harmless typo: plain
 * `repack-atlas` is not on the registry, so a doc or an error message that
 * shows it sends a user to a package that installs nothing.
 *
 * Five names share the `repack-atlas` substring and only one of them changed
 * (#80). This rule flags the import specifier and nothing else:
 *
 *   changes  → `@callstack/repack-atlas/plugin`        (the specifier)
 *   keeps    → `repack-atlas --version`                (the binary)
 *   keeps    → `cd repack-atlas`, `../repack-atlas/…`  (a clone directory)
 *   keeps    → `.repack-atlas/introspection.json`      (per-app artifact)
 *   keeps    → `repack-federation.json`                (root artifact)
 *
 * A line that must show the wrong form — a rule's own test fixture, prose
 * explaining the mistake — ends with the pragma below and is skipped, alone.
 *
 * Scans the tracked tree, so it cannot be satisfied by an untracked scratch
 * file. `odd/` is excluded: those are dated process records, and rewriting
 * history to please a lint rule destroys provenance.
 *
 * Exit codes: 0 clean, 1 violations found, 2 could not answer (no git).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Ending a line with this word allows the unscoped spelling on that line only. */
export const ALLOW_PRAGMA = 'allow-unscoped-specifier';

/**
 * The pragma is an end-of-line marker, not a keyword. Matching it anywhere
 * would let prose that merely names the pragma, or a suffixed variant such as
 * `no-allow-unscoped-specifier`, mute the rule from anywhere on the line. The
 * leading boundary rejects a hyphen or word character glued to the front.
 */
const PRAGMA_AT_LINE_END = new RegExp(`(?:^|[^\\w-])${ALLOW_PRAGMA}\\s*$`);

/** Repo-relative path prefixes that are out of scope, history prose mainly. */
export const EXCLUDED_PREFIXES = ['odd/'];

/** File types that can carry a specifier a human or an agent will copy. */
const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.md', '.json'];

// The `\/` escapes are load-bearing as well as required: written as a plain
// `/`, this source line would itself match the pattern and the guard could
// never pass on its own file.
const UNSCOPED = /(^|[^./@a-z-])repack-atlas\/(plugin|introspection)/;

/**
 * Every line of `text` that shows the unscoped public subpath.
 * @param {string} path repo-relative path, reported back verbatim.
 * @param {string} text file contents.
 * @returns {{ path: string, line: number, text: string }[]}
 */
export function findUnscopedSpecifiers(path, text) {
  /** @type {{ path: string, line: number, text: string }[]} */
  const found = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (PRAGMA_AT_LINE_END.test(line)) continue;
    if (UNSCOPED.test(line)) {
      found.push({ path, line: index + 1, text: line.trim() });
    }
  }
  return found;
}

/** @returns {string[]} repo-relative paths of the tracked files to scan. */
function listTrackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out
    .split('\0')
    .filter(Boolean)
    .filter((file) => SCANNED_EXTENSIONS.some((ext) => file.endsWith(ext)))
    .filter((file) => !EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix)));
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length > 0) {
    console.error('usage: specifier-check.mjs (takes no arguments)');
    return 2;
  }

  let files;
  try {
    files = listTrackedFiles();
  } catch (error) {
    console.error(`specifier-check: git ls-files failed: ${error.message}`);
    return 2;
  }
  if (files.length === 0) {
    console.error('specifier-check: git listed no scannable files');
    return 2;
  }

  /** @type {string[]} */
  const lines = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(join(REPO_ROOT, file), 'utf8');
    } catch (error) {
      // A tracked file we cannot read is "could not answer", never a pass.
      console.error(`specifier-check: cannot read ${file}: ${error.message}`);
      return 2;
    }
    for (const hit of findUnscopedSpecifiers(file, text)) {
      lines.push(`${hit.path}:${hit.line}: ${hit.text}`);
    }
  }

  if (lines.length > 0) {
    for (const line of lines) console.log(line);
    console.error(
      `specifier-check: ${lines.length} unscoped specifier(s). The published name is ` +
        `'@callstack/repack-atlas'; end a line that must show the old form with ` +
        `'${ALLOW_PRAGMA}' (see #80).`,
    );
    return 1;
  }

  console.log(`specifier-check: OK - ${files.length} tracked file(s) scanned`);
  return 0;
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) process.exit(main());
