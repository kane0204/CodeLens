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
import { logger } from '../lib/logger';

const STATUS_TIMEOUT = 5000;
const B64_CHUNK = 0x8000;

export class ApiError extends Error {
  status: number;
  code?: string;
  requestId?: string;

  constructor(message: string, status = 0, code?: string, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
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

function nonEmptyErrorText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function errorObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function nestedErrorMessage(error: unknown): string | undefined {
  return nonEmptyErrorText(error) || nonEmptyErrorText(errorObject(error)?.message);
}

function messageFromError(data: unknown, fallback: string): string {
  const direct = nonEmptyErrorText(data);
  if (direct !== undefined) return direct;
  const record = errorObject(data);
  if (!record) return fallback;
  return nestedErrorMessage(record.error) || nonEmptyErrorText(record.message) || fallback;
}

function requestIdFromError(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const record = data as Record<string, unknown>;
  return typeof record.request_id === 'string' ? record.request_id : undefined;
}

function nestedErrorCode(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const error = (data as Record<string, unknown>).error;
  if (error && typeof error === 'object') {
    const code = (error as Record<string, unknown>).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

function apiErrorFrom(data: unknown, fallback: string, status: number, code?: string): ApiError {
  return new ApiError(
    messageFromError(data, fallback),
    status,
    code ?? nestedErrorCode(data),
    requestIdFromError(data),
  );
}

/** Uniform timing + failure logging. Never logs payloads, file names or source. */
async function withLogging<T>(
  scope: string,
  endpoint: string,
  meta: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  logger.debug(scope, 'request.start', { endpoint, ...meta });
  try {
    const value = await fn();
    logger.info(scope, 'request.ok', {
      endpoint,
      duration_ms: Math.round(performance.now() - started),
    });
    return value;
  } catch (error) {
    const detail = {
      endpoint,
      duration_ms: Math.round(performance.now() - started),
      status: error instanceof ApiError ? error.status : 0,
      type: error instanceof Error ? error.name : typeof error,
      request_id: error instanceof ApiError ? error.requestId : undefined,
    };
    if (isAbortError(error)) logger.debug(scope, 'request.cancelled', detail);
    else logger.warn(scope, 'request.failed', detail);
    throw error;
  }
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    logger.debug('api', 'response.not_json', { status: response.status });
    return null;
  }
}

function postJson(path: string, payload: unknown, token: string, signal: AbortSignal): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-CodeLens-Token': token,
    },
    body: JSON.stringify(payload),
    signal,
  });
}

export function fetchStatus(): Promise<StatusInfo> {
  return withLogging('api', '/api/status', {}, fetchStatusInner);
}

function normalizeStatus(data: Partial<StatusInfo>, status: number): StatusInfo {
  if (!data.ready || !data.token) throw new ApiError('分析服务未返回可用令牌', status);
  return {
    ready: data.ready,
    engine_version: String(data.engine_version ?? ''),
    api_revision: Number(data.api_revision ?? 0),
    capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
    token: String(data.token),
  };
}

async function fetchStatusInner(): Promise<StatusInfo> {
  const request = fetch('/api/status', { cache: 'no-store' }).then(async (response) => {
    if (!response.ok) throw new ApiError('服务未就绪', response.status);
    const data = (await response.json()) as Partial<StatusInfo>;
    return normalizeStatus(data, response.status);
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

export function analyzeProject(
  request: AnalyzeRequest,
  token: string,
  onProgress: (progress: AnalyzeProgress) => void,
  signal: AbortSignal,
): Promise<AnalyzeResult> {
  return withLogging('api', '/api/analyze', { files: request.files.length }, () =>
    analyzeProjectInner(request, token, onProgress, signal),
  );
}

async function analyzeProjectInner(
  request: AnalyzeRequest,
  token: string,
  onProgress: (progress: AnalyzeProgress) => void,
  signal: AbortSignal,
): Promise<AnalyzeResult> {
  if (!request.files.length) throw new ApiError('所选目录没有可分析的源码文件');
  onProgress({ phase: 'read', done: 0, total: request.files.length });

  const encoded = await encodeProjectFiles(request.files, onProgress, signal);
  if (signal.aborted) throw abortError();
  onProgress({ phase: 'upload', done: request.files.length, total: request.files.length });

  const response = await postJson('/api/analyze', { project: request.project, files: encoded }, token, signal);
  const data = await parseJson(response);
  if (!response.ok) {
    throw apiErrorFrom(data, `分析请求失败（${response.status}）`, response.status);
  }
  const result = readAnalysisResult(data);
  onProgress({ phase: 'done', done: request.files.length, total: request.files.length });
  return result;
}

async function encodeProjectFiles(
  files: SelectedFile[],
  onProgress: (progress: AnalyzeProgress) => void,
  signal: AbortSignal,
) {
  const encoded: { path: string; content_base64: string }[] = [];
  for (let index = 0; index < files.length; index += 1) {
    if (signal.aborted) throw abortError();
    const item = files[index];
    let buffer: ArrayBuffer;
    try {
      buffer = await item.file.arrayBuffer();
    } catch {
      throw new ApiError(`读取文件失败（第 ${index + 1} 个），请检查文件是否被占用或已移除`);
    }
    encoded.push({ path: item.path, content_base64: toBase64(buffer) });
    onProgress({ phase: 'read', done: index + 1, total: files.length });
  }
  return encoded;
}

function readAnalysisResult(data: unknown): AnalyzeResult {
  if (!data || typeof data !== 'object') throw new ApiError('分析服务返回的数据为空');
  const result = data as Partial<AnalyzeResult>;
  if (!result.summary || !Array.isArray(result.files) || !Array.isArray(result.findings)) {
    throw new ApiError('分析服务返回的数据格式不完整，请重试。');
  }
  return result as AnalyzeResult;
}

export interface ExplainRequest {
  project: string;
  files: { path: string; content: string }[];
  target: ExplainTarget;
  settings: LlmSettings;
}

export function explainCode(
  request: ExplainRequest,
  token: string,
  signal: AbortSignal,
): Promise<ExplainResult> {
  return withLogging('api', '/api/explain', {}, () => explainCodeInner(request, token, signal));
}

async function explainCodeInner(
  request: ExplainRequest,
  token: string,
  signal: AbortSignal,
): Promise<ExplainResult> {
  const payload = withProvider({
    project: request.project,
    files: request.files,
    include_context: true,
    target: request.target,
  }, request.settings);
  const response = await postJson('/api/explain', payload, token, signal);
  const data = await parseJson(response);
  if (!response.ok) {
    throw apiErrorFrom(data, `AI 解读失败（${response.status}）`, response.status);
  }
  return normalizeExplanation(data, request.target);
}

function withProvider(payload: Record<string, unknown>, { baseUrl, model, apiKey }: LlmSettings) {
  if (!baseUrl && !model && !apiKey) return payload;
  return { ...payload, provider: { base_url: baseUrl, model, api_key: apiKey } };
}

function explanationLocation(result: Partial<ExplainResult>, target: ExplainTarget) {
  const { function: name = null, line = null, end_line = null } = result;
  return { file: String(result.file ?? target.file), function: name, line, end_line };
}

function normalizeExplanation(data: unknown, target: ExplainTarget): ExplainResult {
  const result = errorObject(data) as Partial<ExplainResult> | undefined;
  const text = nonEmptyErrorText(result?.text);
  if (!result || text === undefined) throw new ApiError('模型未返回有效解读');
  return {
    text,
    model: String(result.model ?? ''),
    ...explanationLocation(result, target),
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
  error_id?: string;
}

export function reviewProject(
  request: ReviewRequest,
  token: string,
  onProgress: (progress: AiReviewProgress) => void,
  signal: AbortSignal,
): Promise<AiReviewResult> {
  return withLogging('api', '/api/review', {}, () =>
    reviewProjectInner(request, token, onProgress, signal),
  );
}

async function reviewProjectInner(
  request: ReviewRequest,
  token: string,
  onProgress: (progress: AiReviewProgress) => void,
  signal: AbortSignal,
): Promise<AiReviewResult> {
  const payload = withProvider({ project: request.project, files: request.files }, request.settings);
  const response = await postJson('/api/review', payload, token, signal);
  if (!response.ok) {
    const data = await parseJson(response);
    throw apiErrorFrom(data, `AI 审查失败（${response.status}）`, response.status);
  }
  if (!response.body) throw new ApiError('浏览器不支持读取 AI 审查进度');
  return readReviewStream(response.body, onProgress);
}

function parseReviewEvent(line: string): ReviewStreamEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    logger.warn('api', 'review.invalid_ndjson');
    throw new ApiError('AI 审查进度数据格式无效');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError('AI 审查进度数据格式无效');
  }
  return parsed as ReviewStreamEvent;
}

function reviewProgress({ stage, done, total, label }: ReviewStreamEvent): AiReviewProgress | undefined {
  if (!stage || typeof done !== 'number' || typeof total !== 'number') return;
  return { stage, done, total, label: String(label ?? '') };
}

function reviewResult(event: ReviewStreamEvent, onProgress: (progress: AiReviewProgress) => void) {
  const progress = event.type === 'progress' ? reviewProgress(event) : undefined;
  if (progress) {
    onProgress(progress);
    return;
  }
  if (event.type === 'result' && event.result) return event.result;
  if (event.type === 'error') {
    throw new ApiError(event.error || 'AI 审查失败', 502, undefined, event.error_id);
  }
  logger.warn('api', 'review.unknown_event', { type: event.type });
}

async function readReviewStream(
  body: ReadableStream<Uint8Array>,
  onProgress: (progress: AiReviewProgress) => void,
): Promise<AiReviewResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: AiReviewResult | null = null;

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    finalResult = reviewResult(parseReviewEvent(line), onProgress) ?? finalResult;
  };

  try {
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
  } finally {
    reader.releaseLock();
  }
  if (!finalResult) throw new ApiError('AI 审查未返回结果');
  return finalResult;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.requestId ? `${error.message}（错误编号 ${error.requestId}）` : error.message;
  }
  if (error instanceof TypeError) return '连接中断或分析服务未启动，请在项目根目录启动后端服务';
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
