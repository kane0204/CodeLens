import { useEffect, useState } from 'react';
import { deleteHistory, errorText, historyDetail, historyProjects, historyRuns } from '../api/client';
import { useApp } from '../state/AppState';
import type { HistoricalIssue, HistoryDetail, HistoryProject, HistoryRun } from '../types';

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
      if (!controller.signal.aborted) setError(errorText(failure, '无法读取项目历史'));
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
          <p className="text-faint">首次记录 #{item.first} · 最近记录 #{item.last}</p>
        </li>)}
      </ul>
    </section>
  );
}

function HistoryChanges({ detail }: { detail: HistoryDetail }) {
  const { changes, report } = detail;
  const groups = [
    ['新增文件', changes.added], ['修改文件', changes.modified], ['本次未扫描到', changes.missing],
  ] as const;
  return <>
    <p className="mt-1 text-xs text-muted">
      {changes.baseline ? `对比记录 #${changes.baseline}` : '首次分析，已建立基线'}
      {changes.rules_changed && ' · 分析规则有变化'}
    </p>
    <p className="mt-2 text-xs text-muted">
      {report.summary.parsed} 个已解析文件 · {report.findings.length} 条问题 · AI {AI_STATUS[detail.ai_status]}
    </p>
    {groups.every(([, paths]) => !paths.length) && <p className="mt-3 text-xs text-muted">文件清单和内容无变化。</p>}
    {groups.map(([title, paths]) => paths.length > 0 && <details key={title} className="mt-3 rounded border border-line p-2">
      <summary>{title}（{paths.length}）</summary>
      <ul className="mt-1 break-all text-xs">{paths.map((path) => <li key={path}>{path}</li>)}</ul>
    </details>)}
  </>;
}

function issueStatus(issue: HistoricalIssue) {
  if (issue.state === 'resolved') return '已修复';
  if (issue.state === 'unverified') return '待核实';
  if (issue.recurred) return '修复后复发';
  return issue.change === 'new' ? '新增' : '仍存在';
}

function HistoryReport({ detail }: { detail: HistoryDetail }) {
  return <>
    <HistoryChanges detail={detail} />
    <h3 className="mt-4 font-medium">问题变化</h3>
    <ul className="mt-2 space-y-2 text-xs">
      {detail.issues.map((issue) => <li key={JSON.stringify([issue.file, issue.rule_id, issue.symbol])}>
        <strong>{issueStatus(issue)}</strong> · {issue.file} · {issue.rule_id} · {issue.message}
      </li>)}
    </ul>
    <details className="mt-4 rounded border border-line p-2">
      <summary>当时的静态分析结果</summary>
      <ul className="mt-2 space-y-1 text-xs">
        {detail.report.findings.map((finding) => <li key={finding.id}>
          {finding.file}:{finding.line ?? '—'} · {finding.rule_id} · {finding.message}
        </li>)}
      </ul>
    </details>
    {detail.ai && <section className="mt-4">
      <h3 className="font-medium">当时的 AI 审查</h3>
      {Object.values(detail.ai.sections).map((section) => <details key={section.id} className="mt-2 rounded border border-line p-2">
        <summary>{section.title}</summary>
        <p className="mt-2 whitespace-pre-wrap break-words text-xs text-muted">{section.markdown}</p>
      </details>)}
    </section>}
  </>;
}

function HistoryProjects({ items, selected, choose }: {
  items?: HistoryProject[]; selected: string; choose: (id: string) => void;
}) {
  return <div>{items?.map((item) => <button key={item.id} type="button" aria-pressed={selected === item.id}
    className="mb-1 block w-full rounded border border-line p-2 text-left aria-pressed:bg-tint"
    onClick={() => choose(item.id)}>
    {item.name} · {item.id.slice(0, 6)} <span className="text-xs text-muted">{item.runs} 次</span>
  </button>)}</div>;
}

function HistoryRecords({ items, selected, choose, remove }: {
  items?: HistoryRun[]; selected?: number; choose: (id: number) => void; remove: () => void;
}) {
  if (!items?.length) return null;
  return <div className="flex flex-wrap gap-3">
    <label>分析记录 <select value={selected} className="rounded border border-line p-1"
      onChange={(event) => choose(Number(event.target.value))}>
      {items.map((item) => <option key={item.id} value={item.id}>#{item.id} · {item.created} UTC</option>)}
    </select></label>
    <button type="button" className="text-danger hover:underline" onClick={remove}>删除项目历史</button>
  </div>;
}

function useHistoryRecords(project: string, run: number | undefined, token: string) {
  const runs = useHistoryQuery<HistoryRun[]>((signal) => project ? historyRuns(project, token, signal) : undefined,
    [project, token]);
  const selectedRun = run ?? runs.data?.[0]?.id;
  const detail = useHistoryQuery<HistoryDetail>((signal) => project && selectedRun
    ? historyDetail(project, selectedRun, token, signal) : undefined, [project, selectedRun, token]);
  return { runs, selectedRun, detail, error: runs.error || detail.error };
}

function useHistoryView() {
  const { token, capabilities, go, result, toast } = useApp();
  const [project, setProject] = useState(result?.history?.project_id ?? '');
  const [run, setRun] = useState<number>();
  const [refresh, setRefresh] = useState(0);
  const enabled = capabilities?.includes('project-history');
  const projects = useHistoryQuery<HistoryProject[]>((signal) => enabled ? historyProjects(token, signal) : undefined,
    [enabled, token, refresh]);
  const records = useHistoryRecords(project, run, token);

  async function remove() {
    if (!window.confirm('删除这个项目的全部分析历史和 AI 记忆？')) return;
    try {
      await deleteHistory(project, token, new AbortController().signal);
      setProject('');
      setRun(undefined);
      setRefresh((value) => value + 1);
    } catch (failure) {
      toast(errorText(failure, '删除项目历史失败'), 'error');
    }
  }

  function choose(id: string) {
    setProject(id);
    setRun(undefined);
  }
  return { enabled, go, project, projects, ...records,
    error: projects.error || records.error, choose, setRun, remove };
}

export function HistoryView() {
  const { enabled, go, project, projects, runs, selectedRun, detail, error, choose, setRun, remove } = useHistoryView();
  return (
    <div className="h-full overflow-auto rounded-md border border-line bg-card p-4 text-sm">
      <div className="flex items-center justify-between">
        <h1 className="serif text-lg font-semibold">项目历史</h1>
        <button type="button" className="text-primary hover:underline" onClick={() => go('overview')}>返回工作台</button>
      </div>
      {!enabled && <p className="mt-3 text-muted">连接支持项目历史的本机服务后查看。</p>}
      {error && <p className="mt-3 text-danger" role="alert">{error}</p>}
      {projects.data?.length === 0 && <p className="mt-3 text-muted">暂无分析记录。导入项目后会显示在这里。</p>}
      <div className="mt-4 grid gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
        <HistoryProjects items={projects.data} selected={project} choose={choose} />
        <div>
          <HistoryRecords items={runs.data} selected={selectedRun} choose={setRun} remove={() => void remove()} />
          {detail.data && <HistoryReport detail={detail.data} />}
        </div>
      </div>
    </div>
  );
}
