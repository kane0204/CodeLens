import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useApp } from '../state/AppState';
import { filesFromInput, formatBytes, LIMITS, SUPPORTED_LABEL } from '../lib/files';
import { Icon, LensMark } from './Icon';
import { Button, ProgressBar } from './Ui';

function formatEta(seconds: number | null): string {
  if (seconds === null) return '估算中';
  if (seconds < 60) return `约 ${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `约 ${minutes} 分 ${rest} 秒` : `约 ${minutes} 分钟`;
}

function useUploadModel() {
  const { busy, settings, applySettings } = useApp();
  const [form, setForm] = useState({ baseUrl: settings.baseUrl, model: settings.model, apiKey: settings.apiKey });
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (busy) return;
    setForm((current) => ({
      baseUrl: current.baseUrl || settings.baseUrl,
      model: current.model || settings.model,
      apiKey: current.apiKey || settings.apiKey,
    }));
    // 仅在空闲时回填已保存配置，避免打断输入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.baseUrl, settings.model]);

  const persistForm = (): boolean => {
    const ok = applySettings(form);
    setFormError(ok ? '' : '接口地址需为不含账号、查询参数或片段的 HTTP/HTTPS 地址');
    return ok;
  };
  const aiConfigured = Boolean(form.baseUrl.trim() && form.model.trim());
  return { form, setForm, formError, persistForm, aiConfigured };
}

function UploadModelForm({ model }: { model: ReturnType<typeof useUploadModel> }) {
  const { busy } = useApp();
  const { form, setForm, formError, persistForm, aiConfigured } = model;
  return (
    <div className="mt-4 rounded-[6px] border border-line bg-[#fdfbf8] px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-ink">AI 审查配置</p>
        <span className={`inline-flex items-center gap-1 text-[10px] ${aiConfigured ? 'text-success' : 'text-faint'}`}>
          <i className={`inline-block h-1.5 w-1.5 rounded-full ${aiConfigured ? 'bg-success' : 'bg-[#d6cfc4]'}`} />
          {aiConfigured ? '导入后自动执行 AI 审查' : '未配置 · 仅静态分析'}
        </span>
      </div>
      <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[10px] text-faint">接口地址（OpenAI 兼容）</span>
          <input
            value={form.baseUrl}
            onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))}
            onBlur={() => void persistForm()}
            placeholder="https://api.example.com/v1"
            disabled={busy}
            className="num h-8 w-full rounded-[4px] border border-line bg-card px-2 text-[11.5px] outline-none transition-colors focus:border-primary disabled:opacity-60"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] text-faint">模型名称</span>
          <input
            value={form.model}
            onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
            onBlur={() => void persistForm()}
            placeholder="gpt-4o-mini"
            disabled={busy}
            className="num h-8 w-full rounded-[4px] border border-line bg-card px-2 text-[11.5px] outline-none transition-colors focus:border-primary disabled:opacity-60"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] text-faint">API Key（仅内存，不保存）</span>
          <input
            type="password"
            value={form.apiKey}
            onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))}
            onBlur={() => void persistForm()}
            placeholder="sk-…"
            disabled={busy}
            className="num h-8 w-full rounded-[4px] border border-line bg-card px-2 text-[11.5px] outline-none transition-colors focus:border-primary disabled:opacity-60"
          />
        </label>
      </div>
      {formError ? (
        <p className="mt-2 text-[10.5px] leading-relaxed text-danger" role="alert">
          {formError}
        </p>
      ) : null}
    </div>
  );
}

function UploadProgress() {
  const { phase, progress, progressTotal, eta, cancelAnalysis } = useApp();
  const reviewStage = phase.startsWith('AI');
  return (
    <div role="status" className="py-1">
      <div className="mb-3 flex items-center justify-between gap-3 text-[11px] text-muted">
        <span className="min-w-0 truncate font-medium text-ink">{phase || '处理中'}</span>
        <span className="num shrink-0">
          {progressTotal > 1 ? `${progress}/${progressTotal}` : ''} · 剩余 {formatEta(eta)}
        </span>
      </div>
      <ProgressBar value={progress} max={Math.max(progressTotal, 1)} />
      <p className="mt-2 text-[10.5px] text-faint">
        {reviewStage
          ? 'AI 正在分批阅读源码并交叉核对，大项目需要一些时间，可随时取消'
          : '读取与静态分析在本机完成，速度取决于项目规模'}
      </p>
      <Button className="mt-4" variant="danger" size="sm" icon="stop" onClick={cancelAnalysis}>
        取消
      </Button>
    </div>
  );
}

function useFolderDrop(persistForm: () => boolean) {
  const { busy, startFromTransfer } = useApp();
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (busy) return;
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) setDragging(false);
  };
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (busy) return;
    if (!persistForm()) return;
    void startFromTransfer(event.dataTransfer);
  };
  return { dragging, onDragEnter, onDragLeave, onDragOver, onDrop };
}

function FolderDropZone({
  drop, aiConfigured, onChoose,
}: {
  drop: ReturnType<typeof useFolderDrop>;
  aiConfigured: boolean;
  onChoose: () => void;
}) {
  const { busy } = useApp();
  const { dragging, ...dragHandlers } = drop;
  return (
    <div
      className={`mt-4 rounded-[6px] border border-dashed px-5 py-6 text-center transition-colors ${
        dragging ? 'border-primary bg-tint' : 'border-[#c9b493] bg-[#fdfbf8]'
      }`}
      {...dragHandlers}
    >
      {busy ? <UploadProgress /> : (
        <>
          <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-[6px] border border-[#d8c5a9] bg-card text-primary">
            <Icon name="folder" size={22} />
          </span>
          <p className="text-[13px] font-medium text-ink">将项目文件夹拖到此处</p>
          <p className="mt-1 text-[11px] text-muted">
            导入后自动完成静态分析{aiConfigured ? '与 AI 审查' : ''}
          </p>
          <Button
            className="mt-4"
            variant="primary"
            icon="upload"
            onClick={onChoose}
          >
            选择文件夹
          </Button>
        </>
      )}
    </div>
  );
}

function UploadConnectionPrompt() {
  const { status, connect } = useApp();
  return status === 'connecting' ? (
    <div className="mt-4 rounded-[5px] border border-line bg-[#fdfbf8] px-4 py-8 text-center">
      <div className="mx-auto mb-3 h-1 w-32 animate-pulse rounded bg-[#e9e2d6]" />
      <p className="text-[12px] text-muted" role="status">
        正在连接本机分析服务…
      </p>
    </div>
  ) : (
    <div className="mt-4 rounded-[5px] border border-[#fecaca] bg-[#fef2f2] px-4 py-5">
      <div className="flex items-start gap-2 text-[12px] text-danger">
        <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
        <p className="leading-relaxed">
          分析服务未连接。请在项目根目录运行
          <code className="num mx-1 rounded bg-white px-1 py-0.5 text-[11px]">python -B code/backend/server.py</code>
          后重试。
        </p>
      </div>
      <Button className="mt-4" variant="primary" icon="refresh" onClick={() => void connect()}>
        重新连接
      </Button>
    </div>
  );
}

function ProjectPicker({ persistForm, aiConfigured }: { persistForm: () => boolean; aiConfigured: boolean }) {
  const { status, startAnalysis } = useApp();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const drop = useFolderDrop(persistForm);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
  }, []);

  function chooseFolder() {
    if (persistForm()) inputRef.current?.click();
  }

  return (
    <>
      {status === 'ready'
        ? <FolderDropZone drop={drop} aiConfigured={aiConfigured} onChoose={chooseFolder} />
        : <UploadConnectionPrompt />}
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        aria-label="选择项目文件夹"
        onChange={(event) => {
          if (!event.target.files?.length) return;
          void startAnalysis(filesFromInput(event.target.files));
          event.target.value = '';
        }}
      />
    </>
  );
}

function ImportFeedback() {
  const { errors, ignored, result, importing, busy, returnToResult } = useApp();
  const ignoredEntries = Object.entries(ignored);
  return (
    <>
      <p className="mt-3 text-[10.5px] leading-relaxed text-faint">
        最多 {LIMITS.maxFiles} 个源码文件；单文件 ≤1MB；总量 ≤8MB（{formatBytes(LIMITS.maxTotalBytes)}）。
      </p>

      {errors.length ? (
        <div className="scroll-thin mt-3 max-h-36 overflow-auto rounded-[4px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2.5 text-[11.5px] text-danger" role="alert">
          <ul className="list-disc space-y-1 pl-4 leading-relaxed">
            {errors.map((item) => (
              <li key={item} className="break-words">
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {ignoredEntries.length ? (
        <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
          未上传的其他文件：
          {ignoredEntries.map(([ext, count], index) => (
            <span key={ext} className="num">
              {index ? '；' : ''}
              {ext}：{count}
            </span>
          ))}
        </p>
      ) : null}

      {result && importing && !busy ? (
        <button
          type="button"
          className="mt-4 inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline"
          onClick={returnToResult}
        >
          查看上一次结果
          <Icon name="arrowRight" size={12} />
        </button>
      ) : null}
    </>
  );
}

function ConnectionFooter() {
  const { status, version } = useApp();
  return (
    <>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-[10.5px] text-faint">
        <span className="inline-flex items-center gap-1.5">
          <i className={`inline-block h-1.5 w-1.5 rounded-full ${status === 'ready' ? 'bg-success' : status === 'connecting' ? 'bg-[#c9a84c]' : 'bg-danger'}`} />
          {status === 'ready' ? '本机服务已连接' : status === 'connecting' ? '正在连接' : '等待服务连接'}
        </span>
        <span className="num">{version || '—'}</span>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-faint">
        静态分析在本机内存中完成；AI 审查会把已解析源码发送到你配置的模型服务。
      </p>
    </>
  );
}

function UploadIntro() {
  return (
    <section className="stagger-in hidden min-w-0 lg:block">
      <div className="mb-8 flex items-center gap-3">
        <LensMark size={34} />
        <span className="serif text-[19px] font-semibold tracking-[0.01em]">CodeLens</span>
      </div>
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">Static Analysis Workbench</p>
      <h1 className="serif text-[clamp(34px,3.8vw,54px)] font-semibold leading-[1.1] tracking-[-0.015em] text-ink">
        make code visible
      </h1>
      <p className="mt-5 max-w-[44ch] text-[13px] leading-7 text-muted">
        本机静态引擎解析结构与复杂度，AI 审查把逻辑、设计与风险串成一份可核对的报告。所有数字来自真实分析响应。
      </p>
      <dl className="mt-9 grid max-w-[440px] grid-cols-2 gap-x-6 gap-y-4 border-t border-line/80 pt-6">
        {[
          ['结构视角', '文件树 · 模块与包 · 符号'],
          ['质量体检', '高复杂度 · 高嵌套 · 坏味'],
          ['AI 审查', '逻辑 · 设计 · 严重风险'],
          ['证据引用', '行号定位 · 回到源码核对'],
        ].map(([term, desc]) => (
          <div key={term}>
            <dt className="text-[11px] font-semibold tracking-wide text-ink">{term}</dt>
            <dd className="mt-0.5 text-[11px] leading-relaxed text-muted">{desc}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function UploadView() {
  const model = useUploadModel();
  return (
    <div className="paper-grid relative flex h-full w-full items-center justify-center overflow-auto bg-paper px-6 py-10">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#f3ead9]/60 to-transparent" />
      <div className="relative grid w-full max-w-[1080px] grid-cols-1 items-center gap-10 lg:grid-cols-[1fr_460px]">
        <UploadIntro />
        <section className="relative w-full rounded-[8px] border border-line bg-card p-6 shadow-[0_10px_40px_#8b5e3410] stagger-in">
          <div className="mb-5 flex items-center gap-3 lg:hidden">
            <LensMark size={28} />
            <span className="serif text-[17px] font-semibold">CodeLens</span>
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">开始使用</p>
          <h2 className="serif mt-1 text-[22px] font-semibold tracking-[-0.01em]">配置模型，导入项目</h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
            支持 {SUPPORTED_LABEL}；自动排除 .git、依赖与构建目录。
          </p>
          <UploadModelForm model={model} />
          <ProjectPicker persistForm={model.persistForm} aiConfigured={model.aiConfigured} />
          <ImportFeedback />
          <ConnectionFooter />
        </section>
      </div>
    </div>
  );
}
