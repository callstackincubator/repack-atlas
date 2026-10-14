// Types for the plain-JS script so tests/*.ts can import it under strict mode.
export interface Violation {
  rule: string;
  detail: string;
}
export interface ManifestContext {
  /** Paths inside the packed tarball, `package/` stripped. */
  packedFiles: string[];
  /** Canonical origin url, when it could be read. */
  repositoryUrl?: string;
  /**
   * The upstream repo this project publishes to, from `.changeset/config.json`.
   * Outranks `repositoryUrl`, and unlike origin it survives a fork clone.
   */
  expectedRepositoryUrl?: string;
  /** README exactly as packed, for the dead-link rule. */
  readme?: string;
}
export interface WorkflowSource {
  path: string;
  text: string;
}
export function validateManifest(
  manifest: Record<string, unknown>,
  context: ManifestContext,
): Violation[];
export function validateWorkflows(workflows: WorkflowSource[]): Violation[];
export function formatViolations(violations: Violation[]): string[];
export function main(argv?: string[]): number;
