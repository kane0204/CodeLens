export type Severity = 'critical' | 'warning' | 'info';
export type EvidenceType = 'fact' | 'inference';

export interface StatusInfo {
  ready: boolean;
  engine_version: string;
  api_revision: number;
  capabilities: string[];
  token: string;
}

export interface Summary {
  files: number;
  parsed: number;
  failed: number;
  excluded: number;
  functions: number;
  classes: number;
  code_lines: number;
  findings: number;
  average_cc: number | null;
  max_cc: number | null;
}

export interface StatementInfo {
  line: number;
  end_line: number;
  ast_type: string;
  description: string;
  evidence_type: EvidenceType;
}

export interface FunctionInfo {
  id: string;
  name: string;
  file: string;
  line: number;
  end_line: number;
  kind: string;
  cc: number;
  rank: string;
  nesting: number;
  length: number;
  params: number;
  score: number;
  score_grade: string;
  score_deductions: {
    dimension: string;
    over: number;
    penalty: number;
    measured: number;
  }[];
  statements?: StatementInfo[];
}

export interface ClassInfo {
  id: string;
  name: string;
  file: string;
  line: number;
  end_line: number;
  methods: string[];
  bases: string[];
}

export interface ParseError {
  line?: number | null;
  type?: string | null;
  message?: string | null;
}

export interface FileInfo {
  path: string;
  module: string;
  source: string;
  sha256: string;
  status: 'ok' | 'error';
  functions: FunctionInfo[];
  classes: ClassInfo[];
  line_count: number;
  code_lines: number;
  error?: string | ParseError | null;
}

export interface Finding {
  id: string;
  rule_id: string;
  severity: Severity;
  file: string;
  line: number | null;
  message: string;
  suggestion: string | null;
  evidence_type: EvidenceType;
  actual: string | number | null;
  threshold: string | number | null;
  confidence: number | string | null;
  related?: string[];
}

export interface GraphEdge {
  source: string;
  target: string | null;
  file?: string;
  line?: number | null;
  expression?: string;
  kind?: string;
  status?: string;
  internal?: boolean;
  evidence_type?: EvidenceType;
}

export interface GraphData {
  dependencies: GraphEdge[];
  calls: GraphEdge[];
  inheritance: GraphEdge[];
  class_relations: GraphEdge[];
  cycles: string[][];
}

export interface HealthInfo {
  available: boolean;
  reason?: string;
  score: number | null;
  grade: string;
  healthy_ratio?: number;
  function_count?: number;
  distribution?: { excellent: number; good: number; fair: number; poor: number };
  formula?: string;
  basis?: string;
  worst?: { id: string; score: number; grade: string }[];
  notes?: string[];
}

export interface ClassMetric {
  id: string;
  file: string;
  line: number;
  wmc: number;
  dit: number | null;
  cbo: number;
  lcom: number;
}

export interface DuplicateGroup {
  fingerprint: string;
  occurrences: { file: string; line: number }[];
}

export interface SolidInfo {
  rules: string[];
  checked_overrides: number;
  coverage_gaps: { class: string; file: string; line: number; reason: string }[];
  limitations: string[];
  truncated: boolean;
}

export interface SpecialRiskItem {
  severity: Severity;
  file: string;
  line: number | null;
  message: string;
  evidence_type: EvidenceType;
  confidence: number | string | null;
  finding_id?: string;
}

export interface SpecialRiskCategory {
  id: string;
  covered: boolean;
  reason?: string | null;
  items: SpecialRiskItem[];
  truncated: boolean;
  label?: string;
  description?: string;
  severity?: Severity;
  count?: number;
}

export interface SpecialRisks {
  categories: SpecialRiskCategory[];
  total?: number;
  flagged_categories?: number;
}

export interface SequenceStep {
  line: number;
  expression: string;
  target: string | null;
  status: string;
  evidence_type: EvidenceType;
  enclosing: string | null;
  participant: string;
}

export interface SequenceInfo {
  available: boolean;
  files: {
    file: string;
    module: string;
    steps: SequenceStep[];
    total: number;
    truncated: boolean;
  }[];
  participants: string[];
  resolved: number;
  unresolved: number;
  notes: string[];
}

export interface AnalyzeResult {
  schema_version?: string;
  engine_version?: string;
  project: string;
  status?: string;
  config?: {
    rules?: string[];
    thresholds?: { cc?: number; length?: number; nesting?: number };
  };
  summary: Summary;
  files: FileInfo[];
  functions: FunctionInfo[];
  classes: ClassInfo[];
  findings: Finding[];
  graph: GraphData;
  errors: { file: string; line?: number | null; type?: string | null; message?: string | null }[];
  warnings: { file?: string; line?: number | null; message?: string | null }[];
  limitations: string[];
  extra_rules?: unknown;
  solid?: SolidInfo;
  class_metrics: ClassMetric[];
  duplicates: DuplicateGroup[];
  quality_notes: string[];
  health?: HealthInfo;
  sequence?: SequenceInfo;
  special_risks?: SpecialRisks;
  language_counts?: Record<string, number>;
}

export interface ExplainCitation {
  start: number;
  end: number;
  file: string;
  line: number;
  end_line: number;
  valid: boolean;
}

export interface ExplainResult {
  text: string;
  model: string;
  file: string;
  function: string | null;
  line: number | null;
  end_line: number | null;
  context: { file: string; line: number; end_line: number }[];
  scope?: 'project';
  source_files?: number;
  batch_count?: number;
  omitted_context?: boolean;
  citations: ExplainCitation[];
  truncated?: boolean;
}

export interface ExplainTarget {
  file: string;
  function: string | null;
  scope?: 'project';
}

export type AiReviewSectionId = 'logic' | 'design' | 'risks';

export interface AiReviewSection {
  id: AiReviewSectionId;
  title: string;
  markdown: string;
  citations: ExplainCitation[];
}

export interface AiReviewResult {
  scope: 'project';
  model: string;
  project: string;
  source_files: number;
  batch_count: number;
  context: { file: string; line: number; end_line: number }[];
  omitted_context: boolean;
  sections: Record<AiReviewSectionId, AiReviewSection>;
  truncated: boolean;
}

export interface AiReviewProgress {
  stage: 'analyze' | 'read' | 'review' | 'resume';
  done: number;
  total: number;
  label: string;
}

export interface LlmSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export type Route = 'overview' | 'structure' | 'logic' | 'metrics' | 'solid' | 'risks';

export type GraphTab = 'calls' | 'dependencies' | 'inheritance' | 'chain';

export interface SelectedFile {
  path: string;
  file: File;
}
