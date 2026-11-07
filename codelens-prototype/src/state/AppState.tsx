import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { analyzeProject, errorText, fetchStatus, isAbortError, reviewProject } from '../api/client';
import { filesFromDataTransfer, prepareSelection, type RawFile } from '../lib/files';
import { exportReport, type ExportFormat } from '../lib/export';
import type {
  AiReviewProgress,
  AiReviewResult,
  AnalyzeResult,
  ExplainCitation,
  GraphTab,
  LlmSettings,
  Route,
  StatusInfo,
} from '../types';

const SETTINGS_KEY = 'codelens.llm.preferences.v1';

export type ConnectionState = 'connecting' | 'ready' | 'offline';
export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface Highlight {
  start: number;
  end: number;
}

export interface SourceTarget {
  title: string;
  path: string;
  line: number;
  endLine: number;
}

export interface HealthHelp {
  open: boolean;
}

interface AppContextValue {
  status: ConnectionState;
  token: string;
  version: string;
  capabilities: string[];
  result: AnalyzeResult | null;
  route: Route;
  importing: boolean;
  busy: boolean;
  phase: string;
  progress: number;
  progressTotal: number;
  eta: number | null;
  errors: string[];
  ignored: Record<string, number>;
  file: string;
  fn: string;
  highlight: Highlight | null;
  treeSearch: string;
  overOnly: boolean;
  expandedRules: string[];
  expandedFindings: string[];
  graphTab: GraphTab;
  graphEntry: string;
  chainEntry: string;
  graphLayout: 'layered' | 'radial';
  graphGranularity: 'function' | 'file';
  graphDirection: 'TD' | 'LR';
  graphQuery: string;
  drawerNode: string | null;
  exportAi: boolean;
  exportSource: boolean;
  settings: LlmSettings;
  settingsOpen: boolean;
  settingsError: string;
  aiReview: AiReviewResult | null;
  reviewBusy: boolean;
  reviewProgress: AiReviewProgress | null;
  reviewError: string;
  toasts: Toast[];
  confirmReimport: boolean;
  sourceTarget: SourceTarget | null;
  connect: () => Promise<void>;
  go: (route: Route) => void;
  startAnalysis: (raw: RawFile[]) => Promise<void>;
  startFromTransfer: (transfer: DataTransfer) => Promise<void>;
  cancelAnalysis: () => void;
  requestReimport: () => void;
  confirmReimportAction: () => void;
  cancelReimport: () => void;
  returnToResult: () => void;
  toast: (message: string, kind?: ToastKind) => void;
  copyText: (text: string) => Promise<void>;
  selectFile: (path: string) => void;
  selectFunction: (id: string) => void;
  openFunction: (id: string) => void;
  setTreeSearch: (value: string) => void;
  setOverOnly: (value: boolean) => void;
  toggleRule: (rule: string) => void;
  toggleFinding: (id: string) => void;
  setGraph: (patch: Partial<GraphPatch>) => void;
  setDrawerNode: (id: string | null) => void;
  setExportAi: (value: boolean) => void;
  setExportSource: (value: boolean) => void;
  runExport: (format: ExportFormat) => void;
  openSettings: () => void;
  closeSettings: () => void;
  saveSettings: (next: LlmSettings) => void;
  applySettings: (next: LlmSettings) => boolean;
  openSource: (target: SourceTarget) => void;
  closeSource: () => void;
  openCitation: (citation: ExplainCitation) => void;
  locateFinding: (findingId: string) => void;
  runReview: () => Promise<void>;
  cancelReview: () => void;
  resetToOverview: () => void;
}

export interface GraphPatch {
  tab: GraphTab;
  entry: string;
  chainEntry: string;
  layout: 'layered' | 'radial';
  granularity: 'function' | 'file';
  direction: 'TD' | 'LR';
  query: string;
}

const AppContext = createContext<AppContextValue | null>(null);

function loadSettings(): LlmSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { baseUrl: '', model: '', apiKey: '' };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { baseUrl: '', model: '', apiKey: '' };
    const record = parsed as Record<string, unknown>;
    return {
      baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : '',
      model: typeof record.model === 'string' ? record.model : '',
      apiKey: '',
    };
  } catch {
    return { baseUrl: '', model: '', apiKey: '' };
  }
}

function validBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function readHash(): Route {
  const hash = window.location.hash.replace(/^#/, '');
  const allowed: Route[] = ['overview', 'structure', 'logic', 'metrics', 'solid', 'risks'];
  return (allowed as string[]).includes(hash) ? (hash as Route) : 'overview';
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionState>('connecting');
  const [token, setToken] = useState('');
  const [version, setVersion] = useState('');
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [route, setRoute] = useState<Route>(readHash);
  const [importing, setImporting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [progress, setProgress] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [ignored, setIgnored] = useState<Record<string, number>>({});
  const [file, setFile] = useState('');
  const [fn, setFn] = useState('');
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [treeSearch, setTreeSearchState] = useState('');
  const [overOnly, setOverOnlyState] = useState(false);
  const [expandedRules, setExpandedRules] = useState<string[]>([]);
  const [expandedFindings, setExpandedFindings] = useState<string[]>([]);
  const [graphTab, setGraphTab] = useState<GraphTab>('calls');
  const [graphEntry, setGraphEntry] = useState('');
  const [chainEntry, setChainEntry] = useState('');
  const [graphLayout, setGraphLayout] = useState<'layered' | 'radial'>('layered');
  const [graphGranularity, setGraphGranularity] = useState<'function' | 'file'>('function');
  const [graphDirection, setGraphDirection] = useState<'TD' | 'LR'>('TD');
  const [graphQuery, setGraphQuery] = useState('');
  const [drawerNode, setDrawerNode] = useState<string | null>(null);
  const [exportAi, setExportAi] = useState(true);
  const [exportSource, setExportSource] = useState(false);
  const [settings, setSettings] = useState<LlmSettings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [aiReview, setAiReview] = useState<AiReviewResult | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewProgress, setReviewProgress] = useState<AiReviewProgress | null>(null);
  const [reviewError, setReviewError] = useState('');
  const [eta, setEta] = useState<number | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmReimport, setConfirmReimport] = useState(false);
  const [sourceTarget, setSourceTarget] = useState<SourceTarget | null>(null);

  const analyzeController = useRef<AbortController | null>(null);
  const reviewController = useRef<AbortController | null>(null);
  const progressClock = useRef(0);
  const toastId = useRef(1);

  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = toastId.current++;
    setToasts((current) => [...current, { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 3600);
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const connect = useCallback(async () => {
    setStatus('connecting');
    setErrors([]);
    try {
      const info: StatusInfo = await fetchStatus();
      setStatus('ready');
      setToken(info.token);
      setVersion(info.engine_version);
      setCapabilities(info.capabilities);
    } catch {
      setStatus('offline');
      setToken('');
      setErrors(['分析服务未连接，请在项目根目录启动 python -B code/backend/server.py']);
    }
  }, []);

  useEffect(() => {
    void connect();
  }, [connect]);

  const go = useCallback(
    (next: Route) => {
      if (!result) {
        setImporting(true);
        return;
      }
      setDrawerNode(null);
      if (window.location.hash === `#${next}`) setRoute(next);
      else window.location.hash = next;
    },
    [result],
  );

  const resetAfterResult = useCallback((data: AnalyzeResult) => {
    setResult(data);
    setImporting(false);
    setFile(data.files[0]?.path ?? '');
    setFn('');
    setHighlight(null);
    setTreeSearchState('');
    setOverOnlyState(false);
    setExpandedRules([]);
    setExpandedFindings([]);
    setGraphTab('calls');
    setGraphEntry(data.functions[0]?.id ?? '');
    setChainEntry(data.functions[0]?.id ?? '');
    setGraphLayout('layered');
    setGraphGranularity('function');
    setGraphDirection('TD');
    setGraphQuery('');
    setDrawerNode(null);
    setAiReview(null);
    setReviewBusy(false);
    setReviewProgress(null);
    setReviewError('');
    setEta(null);
    setSourceTarget(null);
  }, []);

  // Dev-only harness: lets the visual-check script load a real engine response
  // without driving the native folder picker. Stripped from production builds.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __codelensLoadResult?: (data: AnalyzeResult) => void }).__codelensLoadResult = (data) => {
      resetAfterResult(data);
      setStatus('ready');
      window.location.hash = '#overview';
    };
  }, [resetAfterResult]);

  const executeReview = useCallback(
    async (data: AnalyzeResult): Promise<AiReviewResult | null> => {
      const files = data.files
        .filter((item) => item.status === 'ok' && typeof item.source === 'string')
        .map((item) => ({ path: item.path, content: item.source }));
      if (!files.length) {
        setReviewError('没有成功解析的源码，无法生成 AI 审查。');
        return null;
      }
      const controller = new AbortController();
      reviewController.current = controller;
      setReviewBusy(true);
      setReviewError('');
      setReviewProgress(null);
      progressClock.current = performance.now();
      try {
        const review = await reviewProject(
          { project: data.project, files, settings },
          token,
          (next) => {
            setReviewProgress(next);
            setPhase(next.label || (next.stage === 'read' ? 'AI 正在分批阅读源码' : 'AI 正在生成综合审查'));
            setProgress(next.done);
            setProgressTotal(next.total);
            if (next.done > 0 && next.done < next.total) {
              const elapsed = (performance.now() - progressClock.current) / 1000;
              setEta(Math.max(1, Math.round((elapsed / next.done) * (next.total - next.done))));
            } else {
              setEta(null);
            }
          },
          controller.signal,
        );
        setAiReview(review);
        return review;
      } catch (error) {
        if (isAbortError(error)) {
          setReviewError('已中断。服务端已保留已完成的批次，点击「重新生成」将从断点续跑，不会重复消耗已读内容。');
        } else {
          const message = errorText(error, 'AI 审查失败，请检查模型配置后重试。');
          setReviewError(`${message}（已完成的批次已保存在服务端，重试将从断点继续）`);
        }
        return null;
      } finally {
        if (reviewController.current === controller) {
          reviewController.current = null;
          setReviewBusy(false);
          setEta(null);
        }
      }
    },
    [settings, token],
  );

  const runWithRaw = useCallback(
    async (raw: RawFile[]) => {
      if (busy || status !== 'ready') return;
      const prepared = prepareSelection(raw);
      setErrors(prepared.errors);
      setIgnored(prepared.ignored);
      if (prepared.errors.length) {
        toast('文件不符合分析限制，请查看提示', 'warning');
        return;
      }

      setBusy(true);
      setPhase('读取项目文件');
      setProgress(0);
      setProgressTotal(prepared.files.length);
      setEta(null);
      setImporting(true);

      const controller = new AbortController();
      analyzeController.current = controller;
      progressClock.current = performance.now();

      try {
        const data = await analyzeProject(
          { project: prepared.project, files: prepared.files },
          token,
          (next) => {
            setPhase(next.phase === 'read' ? '读取项目文件' : next.phase === 'upload' ? '本机引擎正在分析' : '分析完成');
            setProgress(next.done);
            setProgressTotal(next.total);
            if (next.phase === 'read' && next.done > 0 && next.done < next.total) {
              const elapsed = (performance.now() - progressClock.current) / 1000;
              setEta(Math.max(1, Math.round((elapsed / next.done) * (next.total - next.done))));
            } else {
              setEta(null);
            }
          },
          controller.signal,
        );
        resetAfterResult(data);

        let message = `分析完成：${data.summary.parsed} 个文件，${data.summary.findings} 条风险`;
        let kind: ToastKind = 'success';
        if (settings.baseUrl.trim() && settings.model.trim()) {
          setImporting(true);
          setPhase('准备 AI 审查');
          setProgress(0);
          setProgressTotal(1);
          const review = await executeReview(data);
          if (review) {
            message = `静态分析与 AI 审查完成：${data.summary.parsed} 个文件`;
          } else {
            message = `${message}；AI 审查未完成，可在页面中重试`;
            kind = 'warning';
          }
          setImporting(false);
        }
        if (window.location.hash !== '#overview') window.location.hash = 'overview';
        setRoute('overview');
        toast(message, kind);
      } catch (error) {
        if (isAbortError(error)) {
          setErrors(['已中止分析。']);
        } else {
          setErrors([errorText(error, '读取或分析失败，请重试。')]);
        }
      } finally {
        analyzeController.current = null;
        setBusy(false);
      }
    },
    [busy, status, token, settings, toast, resetAfterResult, executeReview],
  );

  const startAnalysis = useCallback(
    async (raw: RawFile[]) => {
      await runWithRaw(raw);
    },
    [runWithRaw],
  );

  const startFromTransfer = useCallback(
    async (transfer: DataTransfer) => {
      try {
        const raw = await filesFromDataTransfer(transfer, new AbortController().signal);
        await runWithRaw(raw);
      } catch (error) {
        setErrors([errorText(error, '读取拖拽目录失败，请重试。')]);
      }
    },
    [runWithRaw],
  );

  const cancelAnalysis = useCallback(() => {
    analyzeController.current?.abort();
    reviewController.current?.abort();
  }, []);

  const requestReimport = useCallback(() => setConfirmReimport(true), []);
  const cancelReimport = useCallback(() => setConfirmReimport(false), []);
  const confirmReimportAction = useCallback(() => {
    setConfirmReimport(false);
    setImporting(true);
    setErrors([]);
    setIgnored({});
    setProgress(0);
    void connect();
  }, [connect]);
  const returnToResult = useCallback(() => setImporting(false), []);

  const copyText = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast('已复制到剪贴板', 'success');
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.append(textarea);
        textarea.select();
        try {
          document.execCommand('copy');
          toast('已复制到剪贴板', 'success');
        } catch {
          toast('复制失败，请手动选择内容', 'warning');
        } finally {
          textarea.remove();
        }
      }
    },
    [toast],
  );

  const selectFile = useCallback((path: string) => {
    setFile(path);
    setFn('');
    setHighlight(null);
  }, []);

  const selectFunction = useCallback((id: string) => {
    setFn(id);
    setHighlight(null);
  }, []);

  const openFunction = useCallback(
    (id: string) => {
      const target = result?.functions.find((item) => item.id === id);
      if (target) setFile(target.file);
      setFn(id);
      setHighlight(null);
      go('logic');
    },
    [result, go],
  );

  const setTreeSearch = useCallback((value: string) => setTreeSearchState(value), []);
  const setOverOnly = useCallback((value: boolean) => setOverOnlyState(value), []);

  const toggleRule = useCallback((rule: string) => {
    setExpandedRules((current) =>
      current.includes(rule) ? current.filter((item) => item !== rule) : [...current, rule],
    );
  }, []);

  const toggleFinding = useCallback((id: string) => {
    setExpandedFindings((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }, []);

  const setGraph = useCallback((patch: Partial<GraphPatch>) => {
    if (patch.tab !== undefined) setGraphTab(patch.tab);
    if (patch.entry !== undefined) setGraphEntry(patch.entry);
    if (patch.chainEntry !== undefined) setChainEntry(patch.chainEntry);
    if (patch.layout !== undefined) setGraphLayout(patch.layout);
    if (patch.granularity !== undefined) setGraphGranularity(patch.granularity);
    if (patch.direction !== undefined) setGraphDirection(patch.direction);
    if (patch.query !== undefined) setGraphQuery(patch.query);
    if (patch.tab !== undefined || patch.entry !== undefined || patch.granularity !== undefined) {
      setDrawerNode(null);
    }
  }, []);

  const runExport = useCallback(
    (format: ExportFormat) => {
      if (!result) return;
      exportReport(result, format, {
        includeAi: exportAi,
        includeSource: exportSource,
        review: aiReview,
      });
      toast(`已生成 ${format.toUpperCase()} 报告`, 'success');
    },
    [result, exportAi, exportSource, aiReview, toast],
  );

  const openSettings = useCallback(() => {
    setSettingsError('');
    setSettingsOpen(true);
  }, []);
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    setSettingsError('');
  }, []);

  const applySettings = useCallback((next: LlmSettings): boolean => {
    const baseUrl = next.baseUrl.trim();
    const model = next.model.trim();
    const apiKey = next.apiKey.trim();
    if (baseUrl && !validBaseUrl(baseUrl)) {
      return false;
    }
    setSettings({ baseUrl, model, apiKey });
    try {
      if (baseUrl || model) localStorage.setItem(SETTINGS_KEY, JSON.stringify({ baseUrl, model }));
      else localStorage.removeItem(SETTINGS_KEY);
    } catch {
      // 浏览器禁止本地存储时仅在当前页面生效
    }
    return true;
  }, []);

  const saveSettings = useCallback(
    (next: LlmSettings) => {
      const baseUrl = next.baseUrl.trim();
      const model = next.model.trim();
      const apiKey = next.apiKey.trim();
      if (baseUrl && !validBaseUrl(baseUrl)) {
        setSettingsError('请输入 HTTP 或 HTTPS 基础地址，不要在地址中包含账号、密码、查询参数或片段。');
        return;
      }
      setSettings({ baseUrl, model, apiKey });
      let persisted = true;
      try {
        if (baseUrl || model) localStorage.setItem(SETTINGS_KEY, JSON.stringify({ baseUrl, model }));
        else localStorage.removeItem(SETTINGS_KEY);
      } catch {
        persisted = false;
      }
      setSettingsOpen(false);
      setSettingsError('');
      toast(
        persisted ? '设置已保存，可在逻辑说明 / 设计检查 / 风险评估中重新生成 AI 审查' : '浏览器无法保存设置，本次配置仅在当前页面有效',
        persisted ? 'success' : 'warning',
      );
    },
    [toast],
  );

  const openSource = useCallback((target: SourceTarget) => setSourceTarget(target), []);
  const closeSource = useCallback(() => setSourceTarget(null), []);

  const openCitation = useCallback(
    (citation: ExplainCitation) => {
      setSourceTarget({
        title: '源码引用',
        path: citation.file,
        line: citation.line,
        endLine: citation.end_line,
      });
    },
    [],
  );

  const locateFinding = useCallback(
    (findingId: string) => {
      if (!result) return;
      const finding = result.findings.find((item) => item.id === findingId);
      if (!finding) return;
      const targetFile = result.files.find((item) => item.path === finding.file);
      if (!targetFile || finding.line === null) {
        toast(`目标位置：${finding.file}:${finding.line ?? '—'}，结果中没有对应源码`, 'warning');
        return;
      }
      const ownIds = new Set(targetFile.functions.map((item) => item.id));
      const candidates = result.functions
        .filter(
          (item) =>
            ownIds.has(item.id) &&
            item.line <= (finding.line ?? 0) &&
            (finding.line ?? 0) <= item.end_line,
        )
        .sort((a, b) => a.end_line - a.line - (b.end_line - b.line));
      setFile(targetFile.path);
      setFn(candidates[0]?.id ?? targetFile.functions[0]?.id ?? '');
      setHighlight({ start: finding.line, end: finding.line });
      go('logic');
      toast(`目标位置：${finding.file}:${finding.line}`);
    },
    [result, go, toast],
  );

  const runReview = useCallback(async () => {
    if (!result || reviewBusy) return;
    if (!settings.baseUrl.trim() || !settings.model.trim()) {
      toast('请先在模型设置中填写接口地址与模型名称', 'warning');
      return;
    }
    await executeReview(result);
  }, [result, reviewBusy, settings, executeReview, toast]);

  const cancelReview = useCallback(() => {
    reviewController.current?.abort();
  }, []);

  const resetToOverview = useCallback(() => go('overview'), [go]);

  const value = useMemo<AppContextValue>(
    () => ({
      status,
      token,
      version,
      capabilities,
      result,
      route,
      importing,
      busy,
      phase,
      progress,
      progressTotal,
      eta,
      errors,
      ignored,
      file,
      fn,
      highlight,
      treeSearch,
      overOnly,
      expandedRules,
      expandedFindings,
      graphTab,
      graphEntry,
      chainEntry,
      graphLayout,
      graphGranularity,
      graphDirection,
      graphQuery,
      drawerNode,
      exportAi,
      exportSource,
      settings,
      settingsOpen,
      settingsError,
      aiReview,
      reviewBusy,
      reviewProgress,
      reviewError,
      toasts,
      confirmReimport,
      sourceTarget,
      connect,
      go,
      startAnalysis,
      startFromTransfer,
      cancelAnalysis,
      requestReimport,
      confirmReimportAction,
      cancelReimport,
      returnToResult,
      toast,
      copyText,
      selectFile,
      selectFunction,
      openFunction,
      setTreeSearch,
      setOverOnly,
      toggleRule,
      toggleFinding,
      setGraph,
      setDrawerNode,
      setExportAi,
      setExportSource,
      runExport,
      openSettings,
      closeSettings,
      saveSettings,
      applySettings,
      openSource,
      closeSource,
      openCitation,
      locateFinding,
      runReview,
      cancelReview,
      resetToOverview,
    }),
    [
      status,
      token,
      version,
      capabilities,
      result,
      route,
      importing,
      busy,
      phase,
      progress,
      progressTotal,
      eta,
      errors,
      ignored,
      file,
      fn,
      highlight,
      treeSearch,
      overOnly,
      expandedRules,
      expandedFindings,
      graphTab,
      graphEntry,
      chainEntry,
      graphLayout,
      graphGranularity,
      graphDirection,
      graphQuery,
      drawerNode,
      exportAi,
      exportSource,
      settings,
      settingsOpen,
      settingsError,
      aiReview,
      reviewBusy,
      reviewProgress,
      reviewError,
      toasts,
      confirmReimport,
      sourceTarget,
      connect,
      go,
      startAnalysis,
      startFromTransfer,
      cancelAnalysis,
      requestReimport,
      confirmReimportAction,
      cancelReimport,
      returnToResult,
      toast,
      copyText,
      selectFile,
      selectFunction,
      openFunction,
      setTreeSearch,
      setOverOnly,
      toggleRule,
      toggleFinding,
      setGraph,
      setDrawerNode,
      setExportAi,
      setExportSource,
      runExport,
      openSettings,
      closeSettings,
      saveSettings,
      applySettings,
      openSource,
      closeSource,
      openCitation,
      locateFinding,
      runReview,
      cancelReview,
      resetToOverview,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
