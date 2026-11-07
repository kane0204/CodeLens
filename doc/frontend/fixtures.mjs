export const path = 'src/main.py';
export const fn = {
  id: 'src.main.run', name: 'run', file: path, line: 1, end_line: 3,
  cc: 21, nesting: 5, length: 55, params: 1, score: 75, statements: [],
};
const file = {
  path, module: 'src.main', source: 'def run(flag):\n    return flag\n',
  language: 'Python 3.11', status: 'ok', functions: [fn], classes: [], code_lines: 2, line_count: 2,
};
export const finding = {
  id: 'F-1', rule_id: 'CC-01', severity: 'critical', file: path, line: 1, actual: 21,
  threshold: 10, confidence: 'high', evidence_type: 'fact',
  message: 'Complex branch', suggestion: 'Split the function',
};
export const designFinding = {
  ...finding, id: 'F-2', rule_id: 'LSP-01', severity: 'warning', message: 'Contract mismatch',
};
export const report = {
  project: 'demo', scope: 'project', model: 'example', source_files: 1, batch_count: 1,
  context: [{ file: path, line: 1, end_line: 2 }], truncated: false, omitted_context: false,
  sections: {
    logic: { title: 'Logic', markdown: 'Flow [src/main.py:L1-L2]', citations: [
      { valid: true, file: path, line: 1, end_line: 2 },
    ] },
    design: { title: 'Design', markdown: 'Design notes', citations: [] },
    risks: { title: 'Risks', markdown: 'Risk notes', citations: [] },
  },
};

export function projectResult(overrides = {}) {
  return {
    status: 'complete', project: 'demo', engine_version: 'unit-engine',
    files: [file], functions: [fn], findings: [finding, designFinding],
    classes: [{ id: 'src.main.Worker', name: 'Worker', file: path, line: 1, end_line: 2 }],
    errors: [], graph: { calls: [], dependencies: [{ source: 'main', target: 'src.main', internal: true }],
      inheritance: [], cycles: [] },
    limitations: ['Static analysis only'],
    summary: { files: 1, parsed: 1, failed: 0, excluded: 0, functions: 1, classes: 1,
      findings: 2, code_lines: 2, max_cc: 21, average_cc: 21, languages: { 'Python 3.11': 1 } },
    language_counts: { 'Python 3.11': 1 },
    solid: { rules: ['LSP-01'], limitations: ['Known classes only'], coverage_gaps: [] },
    ...overrides,
  };
}
