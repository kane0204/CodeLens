import type { AiReviewResult, AnalyzeResult, Finding, ScopedReviewResult } from '../types';
import { SEVERITY_LABEL, ruleName } from './format';

export type ExportFormat = 'md' | 'json' | 'csv';
type ReviewSection = keyof AiReviewResult['sections'];

export interface ExportOptions {
  includeLogic: boolean;
  includeDesign: boolean;
  includeRisks: boolean;
  includeSource: boolean;
  review: AiReviewResult | null;
  scopedReviews?: ReadonlyMap<string, ScopedReviewResult>;
}

function selectedReviewSections(options: ExportOptions): ReviewSection[] {
  const sections: ReviewSection[] = [];
  if (options.includeLogic) sections.push('logic');
  if (options.includeDesign) sections.push('design');
  if (options.includeRisks) sections.push('risks');
  return sections;
}

function reviewMarkdown(review: AiReviewResult | null, sections: ReviewSection[]): string {
  if (!sections.length) return '用户选择不包含 AI 说明。';
  if (!review) return '本次尚未生成所选 AI 内容。';
  const headings: Record<ReviewSection, string> = {
    logic: 'AI 逻辑解读',
    design: 'AI 设计检查',
    risks: 'AI 风险评估',
  };
  return `模型：${escapeMarkdown(review.model)}；覆盖 ${review.source_files} 个已解析文件；AI 生成内容，需人工复核。

${sections.map((id) => `## ${headings[id]}

${review.sections[id].markdown}`).join('\n\n')}`;
}

function escapeMarkdown(value: unknown): string {
  return String(value ?? '—')
    .replace(/[\\`*_{}[\]<>#|]/g, '\\$&')
    .replaceAll('\n', ' ');
}

function scopedMarkdown(options: ExportOptions): string {
  if (!options.includeLogic || !options.scopedReviews?.size) return '';
  const sections = [...options.scopedReviews].map(([key, review]) => {
    const path = key.slice(key.indexOf(':') + 1);
    const label = review.sections.logic.title;
    return "### " + escapeMarkdown(label + " · " + path) + "\n\n" + review.sections.logic.markdown;
  });
  return "\n\n## 文件与文件夹解读\n\n" + sections.join("\n\n");
}

function markdown(result: AnalyzeResult, options: ExportOptions): string {
  const summary = result.summary;
  const overview: [string, string][] = [
    ['文件数', String(summary.files)],
    ['已解析', String(summary.parsed)],
    ['解析失败', String(summary.failed)],
    ['已排除', String(summary.excluded)],
    ['函数数', String(summary.functions)],
    ['类数', String(summary.classes)],
    ['代码行数', String(summary.code_lines)],
    ['静态问题', String(summary.findings)],
    ['平均圈复杂度', String(summary.average_cc ?? '—')],
    ['最大圈复杂度', String(summary.max_cc ?? '—')],
  ];
  const findings = result.findings
    .map(
      (item) => `### ${escapeMarkdown(item.rule_id)} · ${ruleName(item.rule_id)} · ${SEVERITY_LABEL[item.severity]}

- 位置：${escapeMarkdown(item.file)}:${item.line ?? '—'}
- 证据等级：${item.evidence_type === 'fact' ? '事实' : '推断'}
- 实际值 / 阈值：${escapeMarkdown(item.actual)} / ${escapeMarkdown(item.threshold)}
- 置信度：${escapeMarkdown(item.confidence)}

${escapeMarkdown(item.message)}

复核建议：${escapeMarkdown(item.suggestion)}
`,
    )
    .join('\n');
  const health = result.health;
  const review = options.review;
  const explanations = reviewMarkdown(review, selectedReviewSections(options));

  return `# CodeLens 分析报告

## 项目概览

项目：${escapeMarkdown(result.project)}

引擎版本：${escapeMarkdown(result.engine_version)}

${overview.map(([label, value]) => `- ${label}：${value}`).join('\n')}

## 静态问题清单

${findings || '没有静态问题。'}

## 分析边界 / 未执行项

${result.limitations.map((note) => `- ${escapeMarkdown(note)}`).join('\n') || '引擎未提供分析边界说明。'}

## SOLID 分析边界

${(result.solid?.limitations ?? []).map((note) => `- ${escapeMarkdown(note)}`).join('\n')}

${(result.solid?.coverage_gaps ?? [])
  .map((gap) => `- ${escapeMarkdown(gap.class)}（${escapeMarkdown(gap.file)}:${gap.line}）：${escapeMarkdown(gap.reason)}`)
  .join('\n')}

## 解析错误

${result.errors.map((item) => `- ${escapeMarkdown(item.file)}:${item.line ?? '—'} ${escapeMarkdown(item.message)}`).join('\n') || '无'}

## 健康度

${health ? `${escapeMarkdown(health.score)} · ${escapeMarkdown(health.grade)}\n\n${escapeMarkdown(health.formula)}` : '无'}

## 类级指标

${(result.class_metrics ?? [])
  .map((item) => `- ${escapeMarkdown(item.id)}：WMC=${item.wmc} DIT=${item.dit ?? '未知'} CBO=${item.cbo} LCOM1=${item.lcom}`)
  .join('\n') || '无'}

## 结构重复

${(result.duplicates ?? [])
  .map((group) => `- ${group.occurrences.map((occurrence) => `${escapeMarkdown(occurrence.file)}:${occurrence.line}`).join(' / ')}`)
  .join('\n') || '无'}

## 类关系

${(result.graph?.class_relations ?? [])
  .map((edge) => `- ${escapeMarkdown(edge.source)} → ${escapeMarkdown(edge.target)}：${escapeMarkdown(edge.kind)}（${escapeMarkdown(edge.file)}:${edge.line ?? '—'}）`)
  .join('\n') || '无'}

${explanations}${scopedMarkdown(options)}
`;
}

function csvCell(value: unknown): string {
  const text = String(value ?? '').replace(/^[=+@-]/, "'$&").replaceAll('"', '""');
  return `"${text}"`;
}

function csv(result: AnalyzeResult): string {
  const keys: (keyof Finding)[] = [
    'id',
    'rule_id',
    'severity',
    'evidence_type',
    'file',
    'line',
    'message',
    'suggestion',
    'actual',
    'threshold',
    'confidence',
  ];
  const rows = result.findings.map((finding) => keys.map((key) => csvCell(finding[key])).join(','));
  return `\uFEFF${[keys.join(','), ...rows].join('\r\n')}`;
}

function triggerDownload(content: string, mime: string, extension: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `codelens-report.${extension}`;
  anchor.setAttribute('aria-label', '下载分析报告');
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportReport(result: AnalyzeResult, format: ExportFormat, options: ExportOptions): void {
  if (format === 'csv') {
    triggerDownload(csv(result), 'text/csv;charset=utf-8', 'csv');
    return;
  }
  if (format === 'md') {
    triggerDownload(markdown(result, options), 'text/markdown;charset=utf-8', 'md');
    return;
  }
  const sections = selectedReviewSections(options);
  type ExportedReview = Omit<AiReviewResult, 'sections'> & {
    sections: Partial<AiReviewResult['sections']>;
  };
  const data: AnalyzeResult & {
    ai_review?: ExportedReview;
    ai_scoped_reviews?: Record<string, ScopedReviewResult>;
  } = structuredClone(result);
  if (!options.includeSource) {
    data.files = data.files.map((file) => ({ ...file, source: '' }));
  }
  if (sections.length && options.review) {
    const selected = options.review.sections;
    data.ai_review = {
      ...options.review,
      sections: Object.fromEntries(sections.map((id) => [id, selected[id]])),
    };
  }
  if (options.includeLogic && options.scopedReviews?.size) {
    data.ai_scoped_reviews = Object.fromEntries(options.scopedReviews);
  }
  triggerDownload(JSON.stringify(data, null, 2), 'application/json;charset=utf-8', 'json');
}
