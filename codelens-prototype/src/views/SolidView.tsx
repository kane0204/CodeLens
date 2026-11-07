import { useMemo } from 'react';
import { useApp } from '../state/AppState';
import { Icon } from '../components/Icon';
import { ReviewMarkdown } from '../components/ReviewMarkdown';
import { Badge, Button, Card, CardHeader, Tag } from '../components/Ui';
import { confidenceLabel, evidenceLabel, ruleName } from '../lib/format';

const SOLID_ORDER = ['SRP-01', 'OCP-01', 'LSP-01', 'ISP-01', 'DIP-01'];

export function SolidView() {
  const {
    result,
    aiReview,
    reviewBusy,
    reviewProgress,
    reviewError,
    runReview,
    cancelReview,
    openSettings,
    locateFinding,
  } = useApp();

  const executed = useMemo(() => {
    if (!result) return [];
    const rules = result.solid?.rules ?? result.config?.rules ?? [];
    return SOLID_ORDER.filter((id) => rules.some((rule) => rule.toUpperCase() === id));
  }, [result]);

  const hits = useMemo(() => {
    if (!result) return [];
    return result.findings.filter((finding) => executed.includes(finding.rule_id));
  }, [result, executed]);

  if (!result) return null;

  const solid = result.solid;
  const gaps = solid?.coverage_gaps ?? [];
  const limitations = solid?.limitations ?? [];
  const hintReasons = [...gaps.map((gap) => `${gap.class}（${gap.file}:${gap.line}）：${gap.reason}`), ...limitations];
  const section = aiReview?.sections.design;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      {hintReasons.length ? (
        <details className="shrink-0 rounded-[4px] border border-line bg-card px-3 py-1.5 text-[10.5px] text-muted">
          <summary className="flex items-center gap-1.5">
            <Icon name="info" size={12} className="shrink-0 text-faint" />
            <span className="min-w-0 flex-1 truncate">部分代码因以下原因未检查：{hintReasons[0]}</span>
            <span className="num shrink-0 text-faint">{hintReasons.length} 条</span>
            <Icon name="chevronDown" size={11} className="shrink-0 text-faint" />
          </summary>
          <ul className="scroll-thin mt-1.5 max-h-28 space-y-1 overflow-auto border-t border-line pt-1.5 leading-relaxed">
            {gaps.map((gap) => (
              <li key={`${gap.class}-${gap.file}-${gap.line}`} className="flex gap-1.5">
                <span className="text-faint">缺口</span>
                <span>
                  {gap.class}（{gap.file}:{gap.line}）：{gap.reason}
                </span>
              </li>
            ))}
            {limitations.map((note) => (
              <li key={note} className="flex gap-1.5">
                <span className="text-faint">边界</span>
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <Card className="min-h-0 flex-1">
        <CardHeader
          title="AI 设计检查"
          icon="layers"
          subtitle="结构与依赖问题 · 来自全项目审查"
          actions={
            <div className="flex items-center gap-1.5">
              {reviewBusy && reviewProgress ? (
                <span className="num mr-1 text-[10px] text-primary">
                  {reviewProgress.label} · {reviewProgress.done}/{reviewProgress.total}
                </span>
              ) : null}
              <Button size="sm" variant="primary" icon="play" onClick={() => void runReview()} disabled={reviewBusy}>
                {section ? '重新生成' : '生成设计检查'}
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
          }
        />
        <div className="scroll-thin min-h-0 flex-1 overflow-auto px-4 py-3">
          {reviewError ? (
            <div className="mb-3 max-w-[860px] rounded-[4px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[11.5px] leading-relaxed text-danger" role="alert">
              {reviewError}
            </div>
          ) : null}

          {reviewBusy && !section ? (
            <div className="max-w-[860px] rounded-[6px] border border-dashed border-[#ddd4c8] bg-[#faf8f4] px-5 py-8" role="status">
              <div className="mb-3 h-1.5 w-40 animate-pulse rounded bg-[#e9e2d6]" />
              <p className="text-[12.5px] font-medium text-ink">AI 正在评估结构设计…</p>
              <p className="mt-1 text-[11px] text-muted">{reviewProgress?.label ?? '基于完整源码与静态分析事实'}</p>
            </div>
          ) : section ? (
            <div className="max-w-[900px]">
              <ReviewMarkdown markdown={section.markdown} citations={section.citations} />
              <p className="mt-4 border-t border-line pt-2.5 text-[10.5px] text-faint">
                模型：{aiReview?.model || '—'} · 仅讨论有源码或静态事实支持的问题，结论需人工确认
              </p>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="w-full max-w-[620px] rounded-[6px] border border-dashed border-[#ddd4c8] bg-[#faf8f4] px-6 py-7">
                <h3 className="serif text-[15px] font-semibold text-ink">让 AI 评估这个项目的设计</h3>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
                  AI 结合完整源码与静态事实，给出总体判断、主要结构问题与建议处理顺序。
                </p>
                <ul className="mt-3 space-y-1.5 text-[11px] leading-relaxed text-muted">
                  {['总体判断：结构是否清晰、职责是否集中', '主要问题：只列有源码或静态事实支持的项', '建议顺序：先改什么、后改什么'].map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-primary" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </Card>

      <details className="shrink-0 rounded-[6px] border border-line bg-card px-3 py-2 shadow-[0_1px_2px_#0000000d]">
        <summary className="flex items-center gap-2 text-[10.5px] font-medium text-primary">
          静态规则证据
          <span className="num text-faint">
            {executed.length ? `${hits.length} 条命中 · ${executed.length} 条规则` : '未执行 SOLID 检查'}
          </span>
        </summary>
        <div className="scroll-thin mt-2 max-h-44 overflow-auto border-t border-line pt-2">
          {executed.length ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {executed.map((id) => {
                const count = hits.filter((finding) => finding.rule_id === id).length;
                return (
                  <Tag key={id} tone={count ? 'warning' : 'success'}>
                    {ruleName(id)} · {count ? `${count} 条` : '未命中'}
                  </Tag>
                );
              })}
            </div>
          ) : (
            <p className="pb-1 text-[10.5px] text-faint">引擎未声明 SRP / OCP / LSP / ISP / DIP 检查。</p>
          )}
          {hits.length ? (
            <ul className="space-y-1.5 pb-1">
              {hits.map((finding) => (
                <li key={finding.id} className="rounded-[4px] border border-line bg-[#fffdf9] px-2.5 py-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge severity={finding.severity} />
                    <button
                      type="button"
                      className="num text-[10px] text-muted hover:text-primary hover:underline"
                      onClick={() => locateFinding(finding.id)}
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
          ) : null}
        </div>
      </details>
    </div>
  );
}
