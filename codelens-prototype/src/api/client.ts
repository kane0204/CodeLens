import type {
  AiReviewProgress,
  AiReviewResult,
  AnalyzeResult,
  ExplainResult,
  ExplainTarget,
  LlmSettings,
  SelectedFile,
  StatusInfo,
} from '../types';

const STATUS_TIMEOUT = 5000;
const B64_CHUNK = 0x8000;

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 0, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const timer = window.setTimeout(() => {
      if (done) return;
      done = true;
      reject(new ApiError(message, 0, 'timeout'));
    }, ms);
    promise.then(
      (value) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function messageFromError(data: unknown, fallback: string): string {
  if (typeof data === 'string' && data.trim()) return data;
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    const error = record.error;
    if (typeof error === 'string' && error.trim()) return error;
    if (error && typeof error === 'object') {
      const nested = error as Record<string, unknown>;
      if (typeof nested.message === 'string' && nested.message.trim()) return nested.message;
    }
    if (typeof record.message === 'string' && record.message.trim()) return record.message;
  }
  return fallback;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function fetchStatus(): Promise<StatusInfo> {
  const request = fetch('/api/status', { cache: 'no-store' }).then(async (response) => {
    if (!response.ok) throw new ApiError('服务未就绪', response.status);
    const data = (await response.json()) as Partial<StatusInfo>;
    if (!data.ready || !data.token) throw new ApiError('分析服务未返回可用令牌', response.status);
    return {
      ready: data.ready,
      engine_version: String(data.engine_version ?? ''),
      api_revision: Number(data.api_revision ?? 0),
      capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
      token: String(data.token),
    };
  });
  return withTimeout(request, STATUS_TIMEOUT, '连接本机引擎超时');
}

export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK));
  }
  return btoa(binary);
}

export interface AnalyzeProgress {
  phase: 'read' | 'upload' | 'done';
  done: number;
  total: number;
}

export interface AnalyzeRequest {
  project: string;
  files: SelectedFile[];
}

export async function analyzeProject(
  request: AnalyzeRequest,
  token: string,
  onProgress: (progress: AnalyzeProgress) => void,
  signal: AbortSignal,
): Promise<AnalyzeResult> {
  if (!request.files.length) throw new ApiError('所选目录没有可分析的源码文件');
  onProgress({ phase: 'read', done: 0, total: request.files.length });

  const encoded: { path: string; content_base64: string }[] = [];
  for (let index = 0; index < request.files.length; index += 1) {
    if (signal.aborted) throw abortError();
    const item = request.files[index];
    const buffer = await item.file.arrayBuffer();
    encoded.push({ path: item.path, content_base64: toBase64(buffer) });
    onProgress({ phase: 'read', done: index + 1, total: request.files.length });
  }

  if (signal.aborted) throw abortError();
  onProgress({ phase: 'upload', done: request.files.length, total: request.files.length });

  const body = JSON.stringify({ project: request.project, files: encoded });
  const response = await fetch('/api/analyze', {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-CodeLens-Token': token,
    },
    body,
    signal,
  });
  const data = await parseJson(response);
  if (!response.ok) {
    throw new ApiError(messageFromError(data, `分析请求失败（${response.status}）`), response.status);
  }
  if (!data || typeof data !== 'object') throw new ApiError('分析服务返回的数据为空');
  const result = data as Partial<AnalyzeResult>;
  if (!result.summary || !Array.isArray(result.files) || !Array.isArray(result.findings)) {
    throw new ApiError('分析服务返回的数据格式不完整，请重试。');
  }
  onProgress({ phase: 'done', done: request.files.length, total: request.files.length });
  return result as AnalyzeResult;
}

export interface ExplainRequest {
  project: string;
  files: { path: string; content: string }[];
  target: ExplainTarget;
  settings: LlmSettings;
}

export async function explainCode(
  request: ExplainRequest,
  token: string,
  signal: AbortSignal,
): Promise<ExplainResult> {
  const configured = Boolean(request.settings.baseUrl || request.settings.model || request.settings.apiKey);
  const payload: Record<string, unknown> = {
    project: request.project,
    files: request.files,
    include_context: true,
    target: request.target,
  };
  if (configured) {
    payload.provider = {
      base_url: request.settings.baseUrl,
      model: request.settings.model,
      api_key: request.settings.apiKey,
    };
  }
  const response = await fetch('/api/explain', {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-CodeLens-Token': token,
    },
    body: JSON.stringify(payload),
    signal,
  });
  const data = await parseJson(response);
  if (!response.ok) {
    throw new ApiError(messageFromError(data, `AI 解读失败（${response.status}）`), response.status);
  }
  if (!data || typeof data !== 'object') throw new ApiError('模型未返回有效解读');
  const result = data as Partial<ExplainResult>;
  if (typeof result.text !== 'string' || !result.text.trim()) throw new ApiError('模型未返回有效解读');
  return {
    text: result.text,
    model: String(result.model ?? ''),
    file: String(result.file ?? request.target.file),
    function: result.function ?? null,
    line: result.line ?? null,
    end_line: result.end_line ?? null,
    context: Array.isArray(result.context) ? result.context : [],
    scope: result.scope,
    source_files: result.source_files,
    batch_count: result.batch_count,
    omitted_context: result.omitted_context,
    citations: Array.isArray(result.citations) ? result.citations : [],
    truncated: result.truncated,
  };
}

export interface ReviewRequest {
  project: string;
  files: { path: string; content: string }[];
  settings: LlmSettings;
}

interface ReviewStreamEvent {
  type: 'progress' | 'result' | 'error';
  stage?: AiReviewProgress['stage'];
  done?: number;
  total?: number;
  label?: string;
  result?: AiReviewResult;
  error?: string;
}

export async function reviewProject(
  request: ReviewRequest,
  token: string,
  onProgress: (progress: AiReviewProgress) => void,
  signal: AbortSignal,
): Promise<AiReviewResult> {
  const configured = Boolean(request.settings.baseUrl || request.settings.model || request.settings.apiKey);
  const payload: Record<string, unknown> = {
    project: request.project,
    files: request.files,
  };
  if (configured) {
    payload.provider = {
      base_url: request.settings.baseUrl,
      model: request.settings.model,
      api_key: request.settings.apiKey,
    };
  }

  const response = await fetch('/api/review', {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-CodeLens-Token': token,
    },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    const data = await parseJson(response);
    throw new ApiError(messageFromError(data, `AI 审查失败（${response.status}）`), response.status);
  }
  if (!response.body) throw new ApiError('浏览器不支持读取 AI 审查进度');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: AiReviewResult | null = null;

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let event: ReviewStreamEvent;
    try {
      event = JSON.parse(line) as ReviewStreamEvent;
    } catch {
      throw new ApiError('AI 审查进度数据格式无效');
    }
    if (event.type === 'progress' && event.stage && typeof event.done === 'number' && typeof event.total === 'number') {
      onProgress({ stage: event.stage, done: event.done, total: event.total, label: String(event.label ?? '') });
      return;
    }
    if (event.type === 'result' && event.result) {
      finalResult = event.result;
      return;
    }
    if (event.type === 'error') {
      throw new ApiError(event.error || 'AI 审查失败', 502);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) handleLine(line);
  }
  buffer += decoder.decode();
  if (buffer.trim()) handleLine(buffer);
  if (!finalResult) throw new ApiError('AI 审查未返回结果');
  return finalResult;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return '连接中断或分析服务未启动，请在项目根目录启动后端服务';
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
