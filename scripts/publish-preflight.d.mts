// Types for the plain-JS script so tests/*.ts can import it under strict mode.
export interface GateResult {
  gate: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  detail: string;
}
export interface GateEvidence {
  manifest: Record<string, unknown>;
  packedFiles: string[];
  readme?: string;
  repositoryUrl?: string;
  workflows: { path: string; text: string }[];
}
export interface BinEvidence {
  /** exit code of `node_modules/.bin/<bin> --version` in the probe project. */
  binCode: number | null;
  /** stdout when the bin ran, stderr when it could not start. */
  binOut: string;
  /** exit code and stdout of the `node dist/cli.js --version` diagnostic. */
  cliCode: number | null;
  cliStdout: string;
  /** version the packed manifest declares. */
  version: string;
  binName?: string;
}
export const gateNames: string[];
export function gateManifest(evidence: GateEvidence): GateResult;
export function gateBin(evidence: BinEvidence): GateResult;
export function collectEvidence(packed: {
  tarball: string;
  files: string[];
}): GateEvidence;
export function main(argv?: string[]): Promise<number>;
