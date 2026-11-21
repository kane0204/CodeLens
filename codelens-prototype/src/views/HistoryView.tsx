import { useEffect, useState } from 'react';
import { deleteHistory, errorText, historyDetail, historyProjects } from '../api/client';
import { useApp } from '../state/AppState';
import type { HistoricalIssue, HistoryProject } from '../types';

const AI_STATUS: Record<string, string> = {
  not_run: '未运行', running: '进行中', done: '已完成', failed: '失败', paused: '已暂停',
};

function useHistoryQuery<T>(load: (signal: AbortSignal) => Promise<T> | undefined, dependencies: unknown[]) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setData(undefined);
    setError('');
    void load(controller.signal)?.then((value) => {
      if (!controller.signal.aborted) setData(value);
    }).catch((failure) => {
      if (!controller.signal.aborted) setError(errorText(failure, '无法读取分析历史'));
    });
    return () => controller.abort();
  }, dependencies);
  return { data, error };
}

export function RecurringIssues({ items }: { items: HistoricalIssue[] }) {
  const { locateFinding } = useApp();
  if (!items.length) return null;
  return (
    <section className="shrink-0 rounded-md border border-line bg-card p-3">
      <h2 className="font-semibold text-ink">反复问题</h2>
      <ul className="mt-2 max-h-32 space-y-2 overflow-auto text-xs">
        {items.map((item) => <li key={item.id}>
          <button type="button" className="text-left font-medium text-primary hover:underline"
            onClick={() => locateFinding(item.id)}>{item.file}{item.line ? `:${item.line}` : ''} · {item.rule_id}</button>
          <p className="mt-0.5 text-muted">{item.recurred ? '修复后复发' : `连续出现于 ${item.streak} 个不同版本`} · {item.message}</p>
        </li>)}
      </ul>
    </section>
  );
}

function HistoryRecord({ item, opening, open, remove }: {
  item: HistoryProject;
  opening: boolean;
  open: () => void;
  remove: () => void;
}) {
  return (
    <article className="flex items-center gap-2 rounded-[5px] border border-line bg-card p-1 shadow-[0_1px_2px_#0000000a]">
      <button type="button" className="min-w-0 flex-1 px-3 py-2 text-left hover:bg-[#fdfbf8]"
        onClick={open} disabled={opening || item.analysis_id === null}>
        <span className="block truncate text-[12.5px] font-medium text-ink">{item.name}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted">
          <span className="num">记录 #{item.analysis_id ?? '—'}</span>
          <span>{item.updated ? item.updated.replace('T', ' ').replace('Z', ' UTC') : '时间未知'}</span>
          <span>AI {AI_STATUS[item.ai_status ?? 'not_run'] ?? item.ai_status}</span>
        </span>
      </button>
      <button type="button" className="mr-1 rounded px-2 py-1 text-[10.5px] text-danger hover:bg-[#fef2f2]"
        onClick={remove}>删除</button>
    </article>
  );
}

function useHistoryView() {
  const { token, capabilities, go, toast, openHistoryResult } = useApp();
  const [refresh, setRefresh] = useState(0);
  const [opening, setOpening] = useState('');
  const enabled = capabilities?.includes('project-history');
  const projects = useHistoryQuery<HistoryProject[]>((signal) =>
    enabled ? historyProjects(token, signal) : undefined, [enabled, token, refresh]);

  async function open(item: HistoryProject) {
    if (item.analysis_id === null) return;
    const controller = new AbortController();
    setOpening(item.id);
    try {
      const detail = await historyDetail(item.id, item.analysis_id, token, controller.signal);
      openHistoryResult(item.id, item.analysis_id, detail);
    } catch (failure) {
      toast(errorText(failure, '打开分析历史失败'), 'error');
    } finally {
      setOpening('');
    }
  }

  async function remove(item: HistoryProject) {
    if (!window.confirm(`删除分析记录“${item.name}”及其 AI 审查？`)) return;
    if (item.analysis_id === null) return;
    try {
      await deleteHistory(item.id, item.analysis_id, token, new AbortController().signal);
      setRefresh((value) => value + 1);
    } catch (failure) {
      toast(errorText(failure, '删除分析记录失败'), 'error');
    }
  }
  return { enabled, go, projects: projects.data, opening,
    error: projects.error, open, remove };
}

export function HistoryView() {
  const { enabled, go, projects, opening, error, open, remove } = useHistoryView();
  return (
    <div className="h-full overflow-auto rounded-md border border-line bg-card p-4 text-sm">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="serif text-lg font-semibold">分析历史</h1>
          <p className="mt-0.5 text-[11px] text-muted">每次导入分析都会单独保存；点击记录直接打开当时的结果。</p>
        </div>
        <button type="button" className="text-primary hover:underline" onClick={() => go('overview')}>返回工作台</button>
      </div>
      {!enabled && <p className="mt-4 text-muted">连接支持分析历史的本机服务后查看。</p>}
      {error && <p className="mt-4 text-danger" role="alert">{error}</p>}
      {enabled && projects?.length === 0 && <p className="mt-4 text-muted">暂无分析记录。完成一次项目导入后会显示在这里。</p>}
      <div className="mt-4 space-y-2">
        {projects?.map((item) => <HistoryRecord key={`${item.id}:${item.analysis_id}`} item={item}
          opening={opening === item.id} open={() => void open(item)} remove={() => void remove(item)} />)}
      </div>
    </div>
  );
}
