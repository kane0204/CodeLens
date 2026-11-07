import { useMemo } from 'react';
import { useApp } from '../state/AppState';
import { ReviewMarkdown } from '../components/ReviewMarkdown';
import { Badge, Button, Card, CardHeader, EmptyState, Tag } from '../components/Ui';
import { confidenceLabel, evidenceLabel, ruleName } from '../lib/format';
import type { Finding } from '../types';

export function RisksView() {
  const { result } = useApp();
  if (!result) return null;
  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      <RiskReviewCard />
      <RiskEvidence />
    </div>
  );
}

function RiskReviewCard() {
  const { aiReview } = useApp();
  const section = aiReview?.sections.risks;
  return (
    <Card className="min-h-0 flex-1">
      <CardHeader
        title="严重危害风险评估"
        icon="shield"
        subtitle="AI 综合评估 · 只报告会造成严重危害的风险"
        actions={<RiskReviewActions hasReview={Boolean(section)} />}
      />
      <RiskReviewBody />
    </Card>
  );
}

interface RiskReviewActionsProps {
  hasReview: boolean;
}

function RiskReviewActions({ hasReview }: RiskReviewActionsProps) {
  const { reviewBusy, reviewProgress, runReview, cancelReview, openSettings } = useApp();
  return (
    <div className="flex items-center gap-1.5">
      {reviewBusy && reviewProgress ? (
        <span className="num mr-1 text-[10px] text-primary">
          {reviewProgress.label} · {reviewProgress.done}/{reviewProgress.total}
        </span>
      ) : null}
      <Button size="sm" variant="primary" icon="play" onClick={() => void runReview()} disabled={reviewBusy}>
        {hasReview ? '重新评估' : '生成风险评估'}
      </Button>
      {reviewBusy ? (
        <Button size="sm" variant="danger" icon="stop" onClick={cancelReview}>
          取消
        </Button>
      ) : (
        <Button size="sm" variant="ghost" icon="settings" onClick={openSettings}>
          模型设置
        </Button>
      )}
    </div>
  );
}

function RiskReviewBody() {
  const { aiReview, reviewBusy, reviewProgress, reviewError } = useApp();
  const section = aiReview?.sections.risks;
  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-auto px-4 py-3">
      {reviewError ? (
        <div className="mb-3 max-w-[860px] rounded-[4px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[11.5px] leading-relaxed text-danger" role="alert">
          {reviewError}
        </div>
      ) : null}

      {reviewBusy && !section ? (
        <div className="max-w-[860px] rounded-[6px] border border-dashed border-[#ddd4c8] bg-[#faf8f4] px-5 py-8" role="status">
          <div className="mb-3 h-1.5 w-40 animate-pulse rounded bg-[#e9e2d6]" />
          <p className="text-[12.5px] font-medium text-ink">AI 正在评估严重危害风险…</p>
          <p className="mt-1 text-[11px] text-muted">{reviewProgress?.label ?? '每项风险按「危害 / 证据 / 建议」组织'}</p>
        </div>
      ) : section ? (
        <div className="max-w-[900px]">
          <ReviewMarkdown markdown={section.markdown} citations={section.citations} />
          <p className="mt-4 border-t border-line pt-2.5 text-[10.5px] text-faint">
            模型：{aiReview?.model || '—'} · 未列出中低危项；结论需结合源码人工复核
          </p>
        </div>
      ) : (
        <EmptyRiskReview />
      )}
    </div>
  );
}

function EmptyRiskReview() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-full max-w-[620px] rounded-[6px] border border-dashed border-[#ddd4c8] bg-[#faf8f4] px-6 py-7">
        <h3 className="serif text-[15px] font-semibold text-ink">让 AI 评估严重危害风险</h3>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
          AI 通读全部源码后，只报告可能造成数据泄露、资金损失、服务中断等严重危害的风险。
        </p>
        <ul className="mt-3 space-y-1.5 text-[11px] leading-relaxed text-muted">
          {['每项按「危害 / 证据 / 建议」三行输出', '结论附源码行号，可直接点击核对', '没有严重危害就明确写未检出，不凑中低危条目'].map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-primary" />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function RiskEvidence() {
  const { result, locateFinding } = useApp();
  const severeFindings = useMemo<Finding[]>(() => {
    if (!result) return [];
    return result.findings.filter((finding) => finding.severity === 'critical');
  }, [result]);

  const severeGroups = useMemo(() => {
    const map = new Map<string, Finding[]>();
    for (const finding of severeFindings) {
      if (!map.has(finding.rule_id)) map.set(finding.rule_id, []);
      map.get(finding.rule_id)?.push(finding);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [severeFindings]);

  return (
    <details className="shrink-0 rounded-[6px] border border-line bg-card px-3 py-2 shadow-[0_1px_2px_#0000000d]">
      <summary className="flex items-center gap-2 text-[10.5px] font-medium text-primary">
        静态高危证据
        <span className="num text-faint">{severeFindings.length ? `${severeFindings.length} 条 · ${severeGroups.length} 类` : '无高级别条目'}</span>
      </summary>
      <div className="scroll-thin mt-2 max-h-48 overflow-auto border-t border-line pt-2">
        {severeGroups.length ? (
          <RiskEvidenceGroups groups={severeGroups} locate={locateFinding} />
        ) : (
          <EmptyState compact title="没有高级别（critical）静态条目" hint="中低危条目与未覆盖检测不在此展示。" />
        )}
      </div>
    </details>
  );
}

interface RiskEvidenceGroupsProps {
  groups: [string, Finding[]][];
  locate: (findingId: string) => void;
}

function RiskEvidenceGroups({ groups, locate }: RiskEvidenceGroupsProps) {
  return (
    <div className="space-y-2 pb-1">
      {groups.map(([rule, hits]) => (
        <section key={rule}>
          <p className="mb-1 flex items-center gap-2 text-[10.5px] font-medium text-ink">
            {ruleName(rule)}
            <Tag tone="neutral">{hits.length}</Tag>
          </p>
          <ul className="space-y-1">
            {hits.map((finding) => (
              <li key={finding.id} className="rounded-[4px] border border-line bg-[#fffdf9] px-2.5 py-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge severity={finding.severity} />
                  <button
                    type="button"
                    className="num text-[10px] text-muted hover:text-primary hover:underline"
                    onClick={() => locate(finding.id)}
                  >
                    {finding.file}:{finding.line ?? '—'}
                  </button>
                  <span className="text-[9.5px] text-faint">
                    {evidenceLabel(finding.evidence_type)} · 置信度 {confidenceLabel(finding.confidence)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-[#57534e]">{finding.message}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
