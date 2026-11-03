export interface CodeFile {
  path: string;
  symbols: string[];
  lines: number;
}
export interface Evidence {
  file: string;
  line: number;
  specifier: string;
  target: string;
  kind: 'import' | 'type' | 'export' | 'dynamic' | 'require';
}
export interface Feature {
  id: string;
  name: string;
  description: string;
  files: string[];
  source: 'directory' | 'manual' | 'ai';
}
export interface Relation {
  id: string;
  source: string;
  target: string;
  evidence: Evidence[];
}
export interface Graph {
  root: string;
  name: string;
  revision: string;
  scannedAt: string;
  files: CodeFile[];
  imports: Evidence[];
  features: Feature[];
  relations: Relation[];
  warnings: string[];
  externalImports: number;
}
export interface CheckResult {
  command: string;
  outcome: 'passed' | 'failed' | 'not-run';
  detail: string;
}
export interface ChangeTask {
  id: string;
  title: string;
  intent: string;
  source: string;
  target: string;
  baseRevision: string;
  createdAt: string;
  updatedAt: string;
  status: 'pending' | 'in-progress' | 'needs-review' | 'verified' | 'cancelled';
  evidence: Evidence[];
  checks: CheckResult[];
  summary: string;
  observedRevision?: string;
  relationRemaining?: boolean;
  verification?: string;
}
