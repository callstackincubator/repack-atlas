// Types for the plain-JS script so tests/*.ts can import it under strict mode.
export const ALLOW_PRAGMA: string;
export const EXCLUDED_PREFIXES: string[];
export interface SpecifierViolation {
  path: string;
  line: number;
  text: string;
}
export function findUnscopedSpecifiers(
  path: string,
  text: string,
): SpecifierViolation[];
