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
export const gateNames: string[];
export function gateManifest(evidence: GateEvidence): GateResult;
export function collectEvidence(packed: {
  tarball: string;
  files: string[];
}): GateEvidence;
export function main(argv?: string[]): Promise<number>;
