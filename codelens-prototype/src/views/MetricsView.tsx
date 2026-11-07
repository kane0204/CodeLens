import { useMemo } from 'react';
import { useApp } from '../state/AppState';
import { Icon, type IconName } from '../components/Icon';
import { Badge, Button, Card, CardHeader, Tag } from '../components/Ui';
import { SEVERITY_WEIGHT, confidenceLabel, evidenceLabel, ruleName } from '../lib/format';
import type { Finding, FunctionInfo, Severity } from '../types';

const CC_THRESHOLD = 10;
const NESTING_THRESHOLD = 4;
const LENGTH_THRESHOLD = 50;

function highestSeverity(items: Finding[]): Severity {
  return [...items].sort((a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity])[0]?.severity ?? 'info';
}

interface SmellSpec {
  icon: IconName;
  title: string;
  threshold: string;
  description: string;
  advice: string;
  tone: 'warning' | 'success';
  count: number;
  worst: FunctionInfo | null;
  worstValue: string;
}

export function MetricsView() {
  const { result, expandedRules, toggleRule, locateFinding, openFunction } = useApp();

  const smells: SmellSpec[] = useMemo(() => {
    const functions = result?.functions ?? [];
    const byCc = functions.filter((item) => item.cc > CC_THRESHOLD).sort((a, b) => b.cc - a.cc);
    const byNesting = functions.filter((item) => item.nesting > NESTING_THRESHOLD).sort((a, b) => b.nesting - a.nesting);
    const byLength = functions.filter((item) => item.length > LENGTH_THRESHOLD).sort((a, b) => b.length - a.length);
    const pick = (items: FunctionInfo[]) => ({
      count: items.length,
      worst: items[0] ?? null,
      tone: (items.length ? 'warning' : 'success') as SmellSpec['tone'],
    });
    const cc = pick(byCc);
    const nesting = pick(byNesting);
    const length = pick(byLength);
    return [
      {
        icon: 'activity',
        title: '高复杂度函数',
        threshold: `圈复杂度 > ${CC_THRESHOLD}`,
        description:
          '圈复杂度统计函数内独立路径的数量。分支越多，需要测试的路径越多，改动时越容易漏掉某个分支。',
        advice: '超过阈值优先考虑拆分支、提前返回或提取子函数，把单条路径变短。',
        tone: cc.tone,
        count: cc.count,
        worst: cc.worst,
        worstValue: cc.worst ? `CC ${cc.worst.cc}` : '',
      },
      {
        icon: 'layers',
        title: '高嵌套函数',
        threshold: `嵌套深度 > ${NESTING_THRESHOLD}`,
        description:
          '嵌套深度衡量 if / 循环 / try 的层叠程度。层数越深，读代码时需要同时记住的上下文越多，是「箭头型代码」的直接信号。',
        advice: '用守卫语句把内层逻辑提前返回，或把最内一层提取成命名清晰的函数。',
        tone: nesting.tone,
        count: nesting.count,
        worst: nesting.worst,
        worstValue: nesting.worst ? `${nesting.worst.nesting} 层` : '',
      },
      {
        icon: 'list',
        title: '超长函数',
        threshold: `有效行数 > ${LENGTH_THRESHOLD}`,
        description:
          '函数的有效行数（不含空行与纯注释）越长，通常意味着承担了多个职责。长函数难以命名、难以复用，也更容易藏重复逻辑。',
        advice: '按「一段一个意图」拆分，让每个函数能用一句话说清自己在做什么。',
        tone: length.tone,
        count: length.count,
        worst: length.worst,
        worstValue: length.worst ? `${length.worst.length} 行` : '',
      },
    ];
  }, [result]);

  const groups = useMemo(() => {
    const map = new Map<string, Finding[]>();
    for (const finding of result?.findings ?? []) {
      if (!map.has(finding.rule_id)) map.set(finding.rule_id, []);
      map.get(finding.rule_id)?.push(finding);
    }
    return [...map.entries()].sort((a, b) => {
      const severity = SEVERITY_WEIGHT[highestSeverity(b[1])] - SEVERITY_WEIGHT[highestSeverity(a[1])];
      return severity || b[1].length - a[1].length;
    });
  }, [result]);

  const duplicates = result?.duplicates ?? [];

  if (!result) return null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="grid shrink-0 grid-cols-1 gap-3 md:grid-cols-3">
        {smells.map((smell) => (
          <Card key={smell.title} className="shrink-0">
            <div className="flex items-start gap-2.5 px-3.5 pt-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-[#e2d7c6] bg-tint text-primary">
                <Icon name={smell.icon} size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="serif text-[13.5px] font-semibold text-ink">{smell.title}</h3>
                  <Tag tone={smell.tone}>{smell.count ? `${smell.count} 个超标` : '未超标'}</Tag>
                </div>
                <p className="num mt-0.5 text-[9.5px] text-faint">判定阈值：{smell.threshold}</p>
              </div>
            </div>
            <p className="px-3.5 pt-2 text-[11px] leading-relaxed text-[#57534e]">{smell.description}</p>
            <p className="px-3.5 pt-1.5 text-[10.5px] leading-relaxed text-muted">建议：{smell.advice}</p>
            <div className="px-3.5 py-2.5">
              {smell.worst ? (
                <button
                  type="button"
                  className="num flex w-full items-center justify-between gap-2 rounded-[4px] border border-line bg-[#fdfbf8] px-2.5 py-1.5 text-left text-[10.5px] transition-colors hover:border-primary"
                  onClick={() => openFunction(smell.worst!.id)}
                  title={smell.worst.id}
                >
                  <span className="min-w-0 truncate text-muted">最严重：{smell.worst.id}</span>
                  <span className="shrink-0 font-medium text-danger">{smell.worstValue}</span>
                </button>
              ) : (
                <p className="flex items-center gap-1.5 rounded-[4px] border border-line bg-[#fdfbf8] px-2.5 py-1.5 text-[10.5px] text-success">
                  <Icon name="check" size={12} />
                  本项目当前没有超阈值函数
                </p>
              )}
            </div>
          </Card>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card className="min-h-0">
          <CardHeader
            title="坏味规则命中"
            icon="scan"
            subtitle={`按规则分组 · 默认收起 · ${groups.length} 类`}
            actions={
              groups.length ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    groups.forEach(([rule]) => {
                      if (expandedRules.includes(rule)) toggleRule(rule);
                    })
                  }
                >
                  全部收起
                </Button>
              ) : null
            }
          />
          <div className="scroll-thin min-h-0 flex-1 overflow-auto">
            {groups.length ? (
              <div className="divide-y divide-[#f1eeea]">
                {groups.map(([rule, hits]) => {
                  const open = expandedRules.includes(rule);
                  return (
                    <section key={rule}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[#fdfbf8]"
                        aria-expanded={open}
                        onClick={() => toggleRule(rule)}
                      >
                        <Icon
                          name="chevronRight"
                          size={12}
                          className={`shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`}
                        />
                        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-ink">{ruleName(rule)}</span>
                        <Tag tone="neutral">{hits.length} 条</Tag>
                        <Badge severity={highestSeverity(hits)} />
                      </button>
                      {open ? (
                        <div className="space-y-1 px-3 pb-2.5 pl-7">
                          {hits.map((finding) => (
                            <div key={finding.id} className="rounded-[4px] border border-line bg-[#fffdf9] px-2.5 py-1.5">
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
                              {finding.suggestion ? (
                                <p className="mt-0.5 text-[10px] leading-relaxed text-faint">建议：{finding.suggestion}</p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-1.5 px-4 py-8">
                <Icon name="check" size={18} className="text-success" />
                <p className="text-[12px] text-success">没有规则命中</p>
                <p className="text-[10.5px] text-faint">未命中不等于没有问题，规则只覆盖可静态判定的坏味。</p>
              </div>
            )}
          </div>
        </Card>

        <div className="flex min-h-0 flex-col gap-3">
          <Card className="min-h-0 flex-1">
            <CardHeader title="结构重复" icon="copy" subtitle={`${duplicates.length} 组`} />
            <div className="scroll-thin min-h-0 flex-1 overflow-auto px-3 py-2">
              {duplicates.length ? (
                <ul className="space-y-2">
                  {duplicates.map((group) => (
                    <li key={group.fingerprint} className="rounded-[4px] border border-line bg-[#fffdf9] px-2.5 py-2">
                      <div className="num flex items-center gap-1.5 text-[9.5px] text-faint">
                        <Icon name="copy" size={10} />
                        {group.occurrences.length} 处 · {group.fingerprint.slice(0, 16)}
                      </div>
                      <ul className="mt-1 space-y-0.5">
                        {group.occurrences.map((occurrence) => (
                          <li key={`${occurrence.file}:${occurrence.line}`} className="num text-[10.5px] text-[#57534e]">
                            {occurrence.file}:{occurrence.line}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex h-full items-center justify-center px-3 text-[11px] text-muted">
                  <Icon name="check" size={13} className="mr-1.5 text-success" />
                  未发现符合检测口径的重复函数体
                </div>
              )}
            </div>
          </Card>

          <details className="shrink-0 rounded-[6px] border border-line bg-card px-3 py-2 shadow-[0_1px_2px_#0000000d]">
            <summary className="text-[10.5px] font-medium text-primary">指标口径与检测边界</summary>
            <ul className="scroll-thin mt-2 max-h-32 space-y-1 overflow-auto text-[10px] leading-relaxed text-muted">
              {(result.quality_notes ?? []).map((note) => (
                <li key={note} className="flex gap-1.5">
                  <span className="text-faint">·</span>
                  <span>{note}</span>
                </li>
              ))}
              {!result.quality_notes?.length ? <li>引擎未提供指标口径说明。</li> : null}
            </ul>
          </details>
        </div>
      </div>
    </div>
  );
}
