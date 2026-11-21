import { useApp } from '../state/AppState';
import { ReviewMarkdown } from '../components/ReviewMarkdown';
import { ReviewLimits } from '../components/ReviewLimits';
import { Button, Card, CardHeader } from '../components/Ui';

export function RisksView() {
  const { result } = useApp();
  if (!result) return null;
  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      <RiskReviewCard />
    </div>
  );
}
function RiskReviewCard() {
  return (
    <Card className="min-h-0 flex-1">
      <CardHeader
        title="严重危害风险评估"
        icon="shield"
        subtitle="AI 生成 · 逻辑解读完成后自动进行，只报告严重危害"
        actions={<RiskReviewActions />}
      />
      <RiskReviewBody />
    </Card>
  );
}

function RiskReviewActions() {
  const { aiReview, reviewBusy, reviewProgress, cancelReview, openSettings } = useApp();
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {reviewBusy && reviewProgress ? (
        <span className="num mr-1 text-[10px] text-primary">
          {reviewProgress.label} · {reviewProgress.done}/{reviewProgress.total}
        </span>
      ) : <span className="text-[10px] text-muted">
        {aiReview?.sections.risks ? '已随逻辑解读生成' : '逻辑解读完成后自动生成'}
      </span>}
      {reviewBusy && <Button size="sm" variant="danger" icon="stop" onClick={cancelReview}>取消</Button>}
      <Button size="sm" variant="ghost" icon="settings" onClick={openSettings}>模型设置</Button>
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
          <ReviewLimits review={aiReview} section="risks" />
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
        <h3 className="serif text-[15px] font-semibold text-ink">风险评估会在逻辑解读完成后生成</h3>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
          返回「逻辑说明」完成一键解读后，AI 会一并生成设计检查与严重危害风险评估。
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
