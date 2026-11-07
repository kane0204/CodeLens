import { useApp } from '../state/AppState';
import { HealthPopover } from '../components/HealthPopover';
import { Icon } from '../components/Icon';
import { Card, CardHeader, EmptyState } from '../components/Ui';
import { SEVERITY_COLOR, SEVERITY_LABEL, ccClass, formatNumber } from '../lib/format';
import type { Severity } from '../types';

const SEVERITIES: Severity[] = ['critical', 'warning', 'info'];

function Gauge({ maxCc, averageCc }: { maxCc: number | null; averageCc: number | null }) {
  if (maxCc === null) {
    return <EmptyState compact title="引擎未产出圈复杂度" hint="本次响应中没有可用的 max_cc。" />;
  }
  const radius = 68;
  const circumference = 2 * Math.PI * radius;
  const arc = circumference * 0.75;
  const ratio = Math.min(1, Math.max(0, maxCc / 20));
  const color = maxCc > 20 ? SEVERITY_COLOR.critical : maxCc > 10 ? SEVERITY_COLOR.warning : '#8b5e34';
  const verdict = maxCc > 20 ? '超过参考阈值 20' : maxCc > 10 ? '超过默认阈值 10' : '未超过默认阈值 10';

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center gap-4 px-4 py-2">
      <svg viewBox="0 0 210 180" className="h-full max-h-[190px] w-auto min-w-[150px]" role="img" aria-label={`最大圈复杂度 ${maxCc}，参考阈值 20`}>
        <circle
          cx="105"
          cy="92"
          r={radius}
          fill="none"
          stroke="#eee7db"
          strokeWidth="13"
          strokeLinecap="round"
          strokeDasharray={`${arc} ${circumference}`}
          transform="rotate(135 105 92)"
        />
        <circle
          cx="105"
          cy="92"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="13"
          strokeLinecap="round"
          strokeDasharray={`${arc * ratio} ${circumference}`}
          transform="rotate(135 105 92)"
        />
        <text x="105" y="98" textAnchor="middle" className="num" fontSize="38" fill="#292524">
          {formatNumber(maxCc)}
        </text>
        <text x="105" y="120" textAnchor="middle" fontSize="10.5" fill="#78716c">
          最大圈复杂度
        </text>
        <text x="105" y="154" textAnchor="middle" fontSize="10" fill="#a8a29e">
          平均 {formatNumber(averageCc)} · 阈值 20
        </text>
      </svg>
      <div className="min-w-0">
        <p className={`text-[12.5px] font-semibold ${maxCc > 10 ? 'text-warning' : 'text-primary'}`}>{verdict}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          圆弧按 0–20 映射；超出部分不再延长圆弧。该图只描述函数复杂度，不代表健康度评分。
        </p>
      </div>
    </div>
  );
}

function RiskPie({ counts }: { counts: Record<Severity, number> }) {
  const total = SEVERITIES.reduce((sum, key) => sum + counts[key], 0);
  if (!total) {
    return <EmptyState compact title="当前分析没有风险条目" hint="findings 为空时不会绘制分布。" />;
  }
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-2">
      <div className="relative">
        <svg viewBox="0 0 150 150" className="h-[132px] w-[132px]" role="img" aria-label="风险严重度分布">
          <circle cx="75" cy="75" r={radius} fill="none" stroke="#f1eeea" strokeWidth="17" />
          {SEVERITIES.map((key) => {
            const value = counts[key];
            if (!value) return null;
            const length = (value / total) * circumference;
            const segment = (
              <circle
                key={key}
                cx="75"
                cy="75"
                r={radius}
                fill="none"
                stroke={SEVERITY_COLOR[key]}
                strokeWidth="17"
                strokeDasharray={`${length} ${circumference}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 75 75)"
              >
                <title>{`${SEVERITY_LABEL[key]}：${value}`}</title>
              </circle>
            );
            offset += length;
            return segment;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="num text-[24px] font-medium leading-none text-ink">{total}</span>
          <span className="mt-1 text-[9.5px] text-faint">风险条目</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {SEVERITIES.map((key) => (
          <span key={key} className="inline-flex items-center gap-1 text-[10.5px] text-muted">
            <i className="h-1.5 w-1.5 rounded-full" style={{ background: SEVERITY_COLOR[key] }} />
            {SEVERITY_LABEL[key]}
            <b className="num text-ink">{counts[key]}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

export function OverviewView() {
  const { result, go } = useApp();
  if (!result) return null;
  const summary = result.summary;
  const findings = result.findings;
  const counts: Record<Severity, number> = {
    critical: findings.filter((item) => item.severity === 'critical').length,
    warning: findings.filter((item) => item.severity === 'warning').length,
    info: findings.filter((item) => item.severity === 'info').length,
  };
  const health = result.health;

  const stats: { label: string; value: string; hint: string; route?: 'structure' | 'risks'; accent?: string }[] = [
    {
      label: '健康度总分',
      value: health?.available === false ? '—' : formatNumber(health?.score),
      hint: health?.available === false ? '引擎未产出体检结论' : health?.grade ?? '—',
    },
    {
      label: '已解析文件',
      value: formatNumber(summary.parsed),
      hint: `共 ${formatNumber(summary.files)} 个 · 失败 ${formatNumber(summary.failed)}`,
      route: 'structure',
    },
    {
      label: '函数 · 类',
      value: `${formatNumber(summary.functions)} / ${formatNumber(summary.classes)}`,
      hint: '函数 / 类',
      route: 'structure',
    },
    {
      label: '风险条目',
      value: formatNumber(summary.findings),
      hint: `高 ${counts.critical} · 中 ${counts.warning} · 低 ${counts.info}`,
      route: 'risks',
      accent: counts.critical ? 'text-danger' : counts.warning ? 'text-warning' : '',
    },
    {
      label: '圈复杂度 · 平均 / 最大',
      value: `${formatNumber(summary.average_cc)} / ${formatNumber(summary.max_cc)}`,
      hint: '阈值 10 / 20',
      accent: ccClass(summary.max_cc),
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="grid shrink-0 grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-5">
        {stats.map((stat, index) => {
          const content = (
            <>
              <span className="flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-[0.1em] text-faint">
                {stat.label}
                {index === 0 ? <HealthPopover health={health} /> : null}
              </span>
              <strong className={`num mt-1.5 block text-[26px] font-medium leading-none tracking-[-0.02em] ${stat.accent ?? 'text-ink'}`}>
                {stat.value}
              </strong>
              <span className="mt-1.5 flex items-center gap-1 text-[10.5px] text-muted">
                {stat.hint}
                {stat.route ? <Icon name="chevronRight" size={10} className="text-faint" /> : null}
              </span>
            </>
          );
          const baseClass =
            'relative flex flex-col rounded-[6px] border border-line bg-card px-3.5 py-3 text-left shadow-[0_1px_2px_#0000000d] transition-colors';
          if (!stat.route) {
            return (
              <div key={stat.label} className={baseClass}>
                {content}
              </div>
            );
          }
          return (
            <button
              key={stat.label}
              type="button"
              onClick={() => stat.route && go(stat.route)}
              className={`${baseClass} hover:border-[#cdb795] hover:bg-[#fdfbf8]`}
            >
              {content}
            </button>
          );
        })}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="min-h-0">
          <CardHeader title="复杂度参考" icon="activity" subtitle="函数级" />
          <Gauge maxCc={summary.max_cc} averageCc={summary.average_cc} />
        </Card>
        <Card className="min-h-0">
          <CardHeader title="风险分布" icon="shield" />
          <RiskPie counts={counts} />
        </Card>
      </div>
    </div>
  );
}
