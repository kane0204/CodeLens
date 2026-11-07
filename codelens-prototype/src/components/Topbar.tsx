import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppState';
import type { Route } from '../types';
import { Icon, LensMark } from './Icon';
import { Button, IconButton } from './Ui';

export const ROUTES: { key: Route; label: string }[] = [
  { key: 'overview', label: '总览' },
  { key: 'structure', label: '项目结构' },
  { key: 'logic', label: '逻辑说明' },
  { key: 'metrics', label: '质量体检' },
  { key: 'solid', label: '设计检查' },
  { key: 'risks', label: '风险评估' },
];

export function Topbar() {
  const { route, go, result, requestReimport, openSettings } = useApp();
  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-card px-4">
        <div className="flex min-w-0 items-center gap-3">
          <LensMark size={27} />
          <span className="serif shrink-0 text-[16px] font-semibold tracking-[0.01em]">CodeLens</span>
          <span className="hidden h-4 w-px bg-line sm:block" />
          <span className="hidden min-w-0 items-center gap-1.5 sm:flex">
            <span className="text-[10px] uppercase tracking-[0.14em] text-faint">Project</span>
            <span className="num truncate text-[11.5px] font-medium text-muted" title={result?.project}>
              {result?.project ?? '—'}
            </span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <IconButton icon="settings" label="模型设置" onClick={openSettings} />
          <Button size="sm" icon="refresh" onClick={requestReimport} className="hidden sm:inline-flex">
            重新导入
          </Button>
          <ExportMenu />
        </div>
      </header>
      <RouteNavigation route={route} go={go} />
    </>
  );
}

function ExportMenu() {
  const { runExport } = useApp();
  const [exportOpen, setExportOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setExportOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExportOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [exportOpen]);

  function exportReport(format: 'md' | 'json' | 'csv') {
    runExport(format);
    setExportOpen(false);
  }

  return (
    <div className="relative" ref={menuRef}>
      <Button
        size="sm"
        variant="primary"
        icon="download"
        aria-haspopup="menu"
        aria-expanded={exportOpen}
        onClick={() => setExportOpen((value) => !value)}
      >
        导出报告
        <Icon name="chevronDown" size={11} className="ml-0.5" />
      </Button>
      {exportOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+6px)] z-40 w-[248px] overflow-hidden rounded-[6px] border border-line bg-card shadow-[0_16px_36px_#2925241c] animate-fade"
        >
          <ExportOptions />
          <ExportFormats onExport={exportReport} />
        </div>
      ) : null}
    </div>
  );
}

function ExportOptions() {
  const { exportAi, setExportAi, exportSource, setExportSource } = useApp();
  return (
    <div className="space-y-1.5 border-b border-line px-3 py-2.5">
      <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-ink">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-[#8b5e34]"
          checked={exportAi}
          onChange={(event) => setExportAi(event.target.checked)}
        />
        包含已生成的 AI 解读
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-ink">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-[#8b5e34]"
          checked={exportSource}
          onChange={(event) => setExportSource(event.target.checked)}
        />
        JSON 包含源码
      </label>
    </div>
  );
}

interface ExportFormatsProps {
  onExport: (format: 'md' | 'json' | 'csv') => void;
}

function ExportFormats({ onExport }: ExportFormatsProps) {
  return (
    <div className="p-1">
      {[
        ['md', 'Markdown', '概览、风险与分析边界'],
        ['json', 'JSON', '完整指标与可选源码'],
        ['csv', 'CSV', '全部风险条目'],
      ].map(([key, label, hint]) => (
        <button
          key={key}
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2 rounded-[4px] px-2.5 py-2 text-left transition-colors hover:bg-[#fdfbf8]"
          onClick={() => onExport(key as 'md' | 'json' | 'csv')}
        >
          <Icon name="download" size={13} className="shrink-0 text-primary" />
          <span className="min-w-0">
            <span className="block text-[11.5px] font-medium text-ink">{label}</span>
            <span className="block text-[10px] text-faint">{hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

interface RouteNavigationProps {
  route: Route;
  go: (route: Route) => void;
}

function RouteNavigation({ route, go }: RouteNavigationProps) {
  return (
    <nav className="scroll-thin flex h-9 shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-line bg-card px-3" aria-label="主导航">
      {ROUTES.map((item) => {
        const active = route === item.key;
        return (
          <button
            key={item.key}
            type="button"
            aria-current={active ? 'page' : undefined}
            className={`relative whitespace-nowrap px-3 text-[11.5px] font-medium transition-colors ${
              active ? 'text-primary' : 'text-muted hover:text-ink'
            }`}
            onClick={() => go(item.key)}
          >
            {item.label}
            {active ? <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-primary" /> : null}
          </button>
        );
      })}
    </nav>
  );
}
