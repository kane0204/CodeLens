import type { EvidenceType, Severity } from '../types';

export const RULE_NAMES: Record<string, string> = {
  'CC-01': '圈复杂度',
  'LEN-01': '函数长度',
  'DEPTH-01': '嵌套深度',
  A4: '硬编码密钥',
  'A3-IO': '边界输入',
  'CYCLE-01': '循环依赖',
  'SRP-01': '单一职责',
  'OCP-01': '开闭原则',
  'LSP-01': '里氏替换',
  'ISP-01': '接口隔离',
  'DIP-01': '依赖倒置',
  'A5-DEAD': '死代码',
  'A8-DEFENSIVE': '过宽异常捕获',
  'DUP-01': '结构重复',
  'CMT-01': '注释与实现不一致',
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: '高',
  warning: '中',
  info: '低',
};

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: '#b91c1c',
  warning: '#c2410c',
  info: '#a8a29e',
};

export function ruleName(id: string): string {
  return RULE_NAMES[id] ?? id;
}

export function severityBadgeClass(severity: Severity): string {
  if (severity === 'critical') return 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]';
  if (severity === 'warning') return 'border-[#fed7aa] bg-[#fff7ed] text-[#c2410c]';
  return 'border-[#e7e5e4] bg-[#f5f5f4] text-[#57534e]';
}

export function evidenceLabel(evidence: EvidenceType | string | undefined): string {
  return evidence === 'fact' ? '事实' : evidence === 'inference' ? '推断' : '—';
}

export function confidenceLabel(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number' && Number.isFinite(value)) return `${Math.round(value * 100)}%`;
  const map: Record<string, string> = { high: '高', medium: '中', low: '低' };
  const key = String(value).toLowerCase();
  return map[key] ?? String(value);
}

export function ccClass(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (value > 20) return 'text-[#b91c1c]';
  if (value > 10) return 'text-[#c2410c]';
  return '';
}

export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? '—' : String(value);
}

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  return `${Math.round(ratio * 100)}%`;
}

export function moduleName(path: string): string {
  return path
    .replace(/\.(py|pyi|c|h|cc|cpp|cxx|hpp|java|js|jsx|ts|tsx|go)$/i, '')
    .replace(/\/__init__$/, '')
    .replace(/\/index$/, '')
    .replaceAll('/', '.');
}

export function truncateMiddle(text: string, limit = 32): string {
  if (text.length <= limit) return text;
  const half = Math.floor((limit - 1) / 2);
  return `${text.slice(0, half)}…${text.slice(-half)}`;
}

export function sortByKey<T>(items: T[], key: (item: T) => string | number | null | undefined): T[] {
  return [...items].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    if (left === right) return 0;
    if (left === null || left === undefined) return 1;
    if (right === null || right === undefined) return -1;
    return left < right ? -1 : 1;
  });
}

export function compareText(a: string | null | undefined, b: string | null | undefined): number {
  const left = String(a ?? '');
  const right = String(b ?? '');
  return left < right ? -1 : left > right ? 1 : 0;
}
