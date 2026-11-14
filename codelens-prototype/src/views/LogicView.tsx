import { errorText, readCachedReview, reviewProject } from '../api/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, type Highlight } from '../state/AppState';
import { FileTree } from '../components/FileTree';
import { Icon } from '../components/Icon';
import { ReviewMarkdown } from '../components/ReviewMarkdown';
import { Button, Card, CardHeader, EmptyState } from '../components/Ui';
import type { AiReviewProgress, AiReviewResult, AnalyzeResult, FileInfo, ScopedReviewResult } from '../types';

type ReviewActions = ReturnType<typeof useScopedReviews>;

type LogicSection = AiReviewResult['sections']['logic'];

function LogicToolbar({ section, actions }: { section: LogicSection | undefined; actions: ReviewActions }) {
  const { highlight, reviewBusy, reviewProgress, cancelReview, copyText } = useApp();
  return (

    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-[#fdfbf8] px-3 py-2">
      <Button
        size="sm"
        variant="primary"
        icon="play"
        onClick={() => void actions.runAll()}
        disabled={reviewBusy || Boolean(actions.active) || !actions.pending}
      >
        {actions.paused ? '继续解读' : '一键解读所有文件和文件夹'}
      </Button>
      <ReviewPause actions={actions} reviewBusy={reviewBusy} cancelReview={cancelReview} />
      <HistoryReviewOption disabled={reviewBusy || Boolean(actions.active)} />
      {section ? (
        <Button size="sm" variant="ghost" icon="copy" onClick={() => void copyText(section.markdown)}>
          复制解读
        </Button>
      ) : null}
      {reviewBusy && reviewProgress ? (
        <span className="num text-[10px] text-primary">
          {reviewProgress.label || (reviewProgress.stage === 'read' ? '阅读源码' : '生成审查')} · {reviewProgress.done}/{reviewProgress.total}
        </span>
      ) : null}
      {highlight ? (
        <span className="num ml-auto text-[10px] text-primary">
          已定位 L{highlight.start}
          {highlight.end !== highlight.start ? `–${highlight.end}` : ''}
        </span>
      ) : null}
    </div>
  );
}

function HistoryReviewOption({ disabled }: { disabled: boolean }) {
  const { result, useHistory, setUseHistory } = useApp();
  if (!result?.history) return null;
  return <label className="flex items-center gap-1 text-[10.5px] text-muted"
    title="相关摘要会随综合审查发送到已配置的模型服务">
    <input type="checkbox" checked={useHistory} disabled={disabled}
      onChange={(event) => setUseHistory(event.target.checked)} />
    参考项目历史
  </label>;
}

function ReviewPause({ actions, reviewBusy, cancelReview }: {
  actions: ReviewActions;
  reviewBusy: boolean;
  cancelReview: () => void;
}) {
  if (!actions.active && !reviewBusy) return null;
  return (
    <Button size="sm" variant="ghost" onClick={actions.active ? actions.pause : cancelReview}>
      暂停
    </Button>
  );
}

function LogicReport({ aiReview, section }: { aiReview: AiReviewResult | ScopedReviewResult; section: LogicSection }) {
  return (
    <div className="max-w-[900px]">
      <ReviewMarkdown markdown={section.markdown} citations={section.citations} />
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2.5 text-[10.5px] text-faint">
        <span className="num">模型：{aiReview.model || '—'}</span>
        <span className="num">
          覆盖 {aiReview.source_files ?? 0} 个已解析文件{aiReview.batch_count > 1 ? ` · ${aiReview.batch_count} 批` : ''}
        </span>
        <span>解读基于完整源码与静态分析事实，点击引用回到源码核对</span>
        {aiReview.history_references?.length ? <span>参考历史 {aiReview.history_references.map((id) => `#${id}`).join('、')}</span> : null}
      </div>
      {aiReview.omitted_context ? (
        <p className="mt-2 rounded-[4px] border border-[#fed7aa] bg-[#fff7ed] px-3 py-1.5 text-[10.5px] text-warning">
          部分静态事实超出上下文上限，未全部发送。
        </p>
      ) : null}
      {aiReview.truncated ? (
        <p className="mt-2 rounded-[4px] border border-[#fed7aa] bg-[#fff7ed] px-3 py-1.5 text-[10.5px] text-warning">
          阅读记录或模型输出达到长度限制，当前解读可能不完整。
        </p>
      ) : null}
    </div>
  );
}

function LogicReviewPrompt() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-full max-w-[620px] rounded-[6px] border border-dashed border-[#ddd4c8] bg-[#faf8f4] px-6 py-7">
        <h3 className="serif text-[15px] font-semibold text-ink">生成文件与文件夹解读</h3>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
          一键解读会逐项处理已解析文件及其文件夹。完成后点击左侧文件或文件夹即可查看。
        </p>
        <ul className="mt-3 space-y-1.5 text-[11px] leading-relaxed text-muted">
          {['项目做什么、入口与主流程', '模块之间如何协作、数据如何流转', '异常边界与需要人工复核的地方'].map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-primary" />
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[10.5px] text-faint">
          在「模型设置」中配置接口与模型后即可开始解读。
        </p>
      </div>
    </div>
  );
}

function LogicReviewContent() {
  const { aiReview, reviewBusy, reviewProgress } = useApp();
  const section = aiReview?.sections.logic;
  if (aiReview && section) return <LogicReport aiReview={aiReview} section={section} />;
  if (reviewBusy) {
    return (
      <div className="max-w-[860px] rounded-[6px] border border-dashed border-[#ddd4c8] bg-[#faf8f4] px-5 py-8" role="status">
        <div className="mb-3 h-1.5 w-40 animate-pulse rounded bg-[#e9e2d6]" />
        <p className="text-[12.5px] font-medium text-ink">AI 正在通读项目源码…</p>
        <p className="mt-1 text-[11px] text-muted">
          {reviewProgress?.label ?? '分批阅读后会交叉核对，生成覆盖逻辑、设计与风险的综合解读'}
        </p>
      </div>
    );
  }
  return <LogicReviewPrompt />;
}

function SourcePreview({ targetFile, highlight }: { targetFile: FileInfo | undefined; highlight: Highlight | null }) {
  if (targetFile?.source == null) {
    return <EmptyState compact title="分析结果不含源码" hint="该文件未被解析或源码未随响应返回。" />;
  }
  return (
    <details className="mt-4 border-t border-line pt-3" open={Boolean(highlight)}>
      <summary className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
        <Icon name="chevronRight" size={11} />
        查看原始源码 · {targetFile.path}
      </summary>
      <div className="scroll-thin mt-2 max-h-[320px] overflow-auto rounded-[4px] border border-line bg-[#fdfbf8] py-1.5">
        <div className="source-block">
          {targetFile.source.split('\n').map((line, index) => {
            const number = index + 1;
            const active = highlight ? number >= highlight.start && number <= highlight.end : false;
            return (
              <div key={number} data-line={number} className={`source-line ${active ? 'hl' : ''}`}>
                <span className="ln">{number}</span>
                <code>{line || ' '}</code>
              </div>
            );
          })}
        </div>
      </div>
    </details>
  );
}

interface LogicFilePanelProps {
  result: AnalyzeResult;
  selected: string;
  onSelectFolder: (path: string) => void;
  onSelectFile: () => void;
  completed: ReadonlyMap<string, ScopedReviewResult>;
}

function LogicFilePanel({ result, selected, onSelectFolder, onSelectFile, completed }: LogicFilePanelProps) {
  const { treeSearch, setTreeSearch, selectFile } = useApp();
  return (
    <Card className="min-h-0">
      <CardHeader title="项目文件" icon="folder" actions={<span className="num text-[10px] text-faint">{result.files.length}</span>} />
      <FileTree
        files={result.files}
        classes={result.classes}
        selected={selected}
        search={treeSearch}
        onSearch={setTreeSearch}
        onSelect={(path) => {
          onSelectFile();
          selectFile(path);
        }}
        onSelectFolder={onSelectFolder}
        isReviewed={(kind, path) => completed.has(reviewKey(kind, path))}
      />
    </Card>
  );
}

export function LogicView() {
  const { result } = useApp();
  if (!result) return null;
  return <LogicWorkspace key={result.project} result={result} />;
}

function LogicWorkspace({ result }: { result: AnalyzeResult }) {
  const { file, highlight, aiReview, reviewBusy, reviewError, openSettings } = useApp();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [folder, setFolder] = useState('');
  const targetFile = result.files.find((item) => item.path === file);
  useEffect(() => setFolder(''), [result, file, highlight]);
  const actions = useScopedReviews(result);
  const selected = reviewKey(folder ? 'folder' : 'file', folder || file);
  const review = actions.reviews.get(selected);
  useRestoreScopedReview(result, actions.targets.get(selected), review);
  const section = selectedSection(review, aiReview, actions.started);

  useEffect(() => {
    if (!highlight || !scrollRef.current) return;
    const container = scrollRef.current;
    const line = container.querySelector<HTMLElement>(`[data-line="${highlight.start}"]`);
    if (!line) return;
    const top = line.offsetTop - container.clientHeight / 2 + line.clientHeight;
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [highlight, targetFile?.path, section]);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
      <LogicFilePanel result={result} selected={folder || file} onSelectFolder={setFolder} onSelectFile={() => setFolder('')} completed={actions.reviews} />
      <Card className="min-h-0">
        <CardHeader
          title="AI 逻辑解读"
          icon="code"
          subtitle="解读整个项目、当前文件或当前文件夹"
          actions={
            <Button size="sm" variant="ghost" icon="settings" onClick={openSettings}>
              模型设置
            </Button>
          }
        />
        <LogicToolbar section={section} actions={actions} />
        <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 overflow-auto px-4 py-3">
          {reviewError && (reviewBusy || !actions.started) ? (
            <div className="mb-3 max-w-[860px] rounded-[4px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[11.5px] leading-relaxed text-danger" role="alert">
              {reviewError}
            </div>
          ) : null}
          <SelectedLogicReview actions={actions} selected={selected} folder={folder} />
          {!folder && <SourcePreview targetFile={targetFile} highlight={highlight} />}
        </div>
      </Card>
    </div>
  );
}

interface ReviewTarget {
  key: string;
  path: string;
  kind: 'file' | 'folder';
  files: { path: string; content: string }[];
}

function reviewKey(kind: ReviewTarget['kind'], path: string) {
  return kind + ':' + path;
}

function reviewTargets(result: AnalyzeResult) {
  const targets = new Map<string, ReviewTarget>();
  for (const file of result.files) {
    if (file.status !== 'ok' || typeof file.source !== 'string') continue;
    const source = { path: file.path, content: file.source };
    const key = reviewKey('file', file.path);
    targets.set(key, { key, path: file.path, kind: 'file', files: [source] });
    addFolderTargets(targets, source);
  }
  return targets;
}

function addFolderTargets(targets: Map<string, ReviewTarget>, source: ReviewTarget['files'][number]) {
  const folders = source.path.split('/').slice(0, -1);
  let path = '';
  for (const folder of folders) {
    path = path ? path + '/' + folder : folder;
    const key = reviewKey('folder', path);
    const target = targets.get(key) ?? { key, path, kind: 'folder', files: [] };
    target.files.push(source);
    targets.set(key, target);
  }
}

function useScopedReviews(result: AnalyzeResult) {
  const { token, settings, scopedReviews: reviews, saveScopedReview, useHistory } = useApp();
  const targets = useMemo(() => reviewTargets(result), [result]);
  const [error, setError] = useState('');
  const [active, setActive] = useState('');
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState<AiReviewProgress>();
  const request = useRef<AbortController>();

  useEffect(() => {
    setActive('');
    setError('');
    setPaused(false);
    return () => stopReview(request);
  }, [result]);


  function pause() {
    stopReview(request);
    setActive('');
    setPaused(true);
  }

  async function generate(target: ReviewTarget, signal: AbortSignal) {
    setActive(target.path);
    setProgress(undefined);
    const output = await reviewProject(scopedRequest(result, target, settings, useHistory), token, (next) => { if (!signal.aborted) setProgress(next); }, signal);
    if (!signal.aborted) saveScopedReview(result, target.key, output);
  }

  async function run(queue: ReviewTarget[]) {
    if (request.current || !queue.length) return;
    const controller = new AbortController();
    request.current = controller;
    setPaused(false);
    setError('');
    try {
      const failed = await runQueue(queue, controller.signal, generate);
      if (!controller.signal.aborted && failed.length) setError(failed.join("\n"));
    } catch (failure) {
      if (!controller.signal.aborted) setError(errorText(failure, '解读失败，请检查模型设置后重试。'));
    } finally {
      if (request.current === controller) {
        request.current = undefined;
        setActive('');
      }
    }
  }

  return { reviews, error, active, progress, paused, pause, started: Boolean(active || error || paused || reviews.size),
    runSelected: (key: string) => run([...targets.values()].filter((target) => target.key === key)),
    pending: targets.size - reviews.size, total: targets.size,
    runAll: () => run(pendingReviews(targets, reviews)), targets };
}

function useRestoreScopedReview(result: AnalyzeResult, target: ReviewTarget | undefined, review?: ScopedReviewResult) {
  const { capabilities, settings, token, saveScopedReview, useHistory } = useApp();
  useEffect(() => {
    if (!capabilities?.includes('review-checkpoints') || !target || review) return;
    const controller = new AbortController();
    const restore = async () => {
      const saved = await readCachedReview(scopedRequest(result, target, settings, useHistory), token, controller.signal);
      if (saved && !controller.signal.aborted) saveScopedReview(result, target.key, saved);
    };
    void restore().catch(() => {
      // A cache miss or unavailable local store leaves the manual review action available.
    });
    return () => controller.abort();
  }, [capabilities, settings, token, saveScopedReview, result, target, review, useHistory]);
}

function stopReview(request: { current: AbortController | undefined }) {
  request.current?.abort();
  request.current = undefined;
}

function scopedRequest(result: AnalyzeResult, target: ReviewTarget, settings: ReturnType<typeof useApp>['settings'], useHistory: boolean) {
  const scope = target.kind === 'folder' ? '文件夹' : '文件';
  return { project: result.project + ' · ' + scope + ' · ' + target.path,
    files: target.files, settings, scope: target.kind, history: result.history,
    useHistory: result.history ? useHistory : undefined };
}

function pendingReviews(targets: Map<string, ReviewTarget>, reviews: ReadonlyMap<string, ScopedReviewResult>) {
  return [...targets.values()].filter((target) => !reviews.has(target.key)).sort(compareReviewTargets);
}

function compareReviewTargets(a: ReviewTarget, b: ReviewTarget) {
  if (a.kind !== b.kind) return a.kind === 'file' ? -1 : 1;
  if (a.kind === 'file') return 0;
  return b.path.split('/').length - a.path.split('/').length;
}

async function runQueue(queue: ReviewTarget[], signal: AbortSignal,
  generate: (target: ReviewTarget, signal: AbortSignal) => Promise<void>) {
  const failed: string[] = [];
  for (const target of queue) {
    if (signal.aborted) break;
    const failure = await tryGenerate(target, signal, generate);
    if (failure) failed.push(failure);
  }
  return failed;
}

async function tryGenerate(target: ReviewTarget, signal: AbortSignal,
  generate: (target: ReviewTarget, signal: AbortSignal) => Promise<void>) {
  try {
    await generate(target, signal);
  } catch (failure) {
    if (signal.aborted) return;
    const message = errorText(failure, '解读失败，请检查模型设置后重试。');
    if (!/连接(?:失败|中断)|超时/.test(message)) throw failure;
    return target.path + ' — ' + message;
  }
}

interface SelectedLogicProps {
  actions: ReviewActions;
  selected: string;
  folder: string;
}

function SelectedLogicReview({ actions, selected, folder }: SelectedLogicProps) {
  const { reviewBusy } = useApp();
  const { reviews, error, active, progress, total } = actions;
  const review = reviews.get(selected);
  const disabled = Boolean(active) || reviewBusy || !actions.targets.has(selected);
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={Boolean(folder) || disabled} onClick={() => actions.runSelected(selected)}>解读当前文件</Button>
        <Button size="sm" disabled={!folder || disabled} onClick={() => actions.runSelected(selected)}>解读当前文件夹</Button>
        {total > 0 && <span className="text-[11px] text-muted">已解读 {reviews.size}/{total} 项</span>}
      </div>
      {active && <ScopedReviewProgress target={active} progress={progress} />}
      {error && <p role="alert" className="mb-3 whitespace-pre-line text-danger">{error}</p>}
      <SelectedReport review={review} folder={folder} started={actions.started} />
    </>
  );
}

function selectedSection(review: ScopedReviewResult | undefined, projectReview: AiReviewResult | null, started: boolean) {
  if (review) return review.sections.logic;
  if (!started) return projectReview?.sections.logic;
  return undefined;
}

function SelectedReport({ review, folder, started }: { review?: ScopedReviewResult; folder: string; started: boolean }) {
  if (review) return <LogicReport aiReview={review} section={review.sections.logic} />;
  if (folder || started) return <EmptyState compact title={folder ? "当前文件夹尚未解读" : "当前文件尚未解读"} />;
  return <LogicReviewContent />;
}

function ScopedReviewProgress({ target, progress }: { target: string; progress?: AiReviewProgress }) {
  return (
    <p role="status">
      正在解读 {target}{progress && <> · {progress.label} · {progress.done}/{progress.total}</>}
    </p>
  );
}
