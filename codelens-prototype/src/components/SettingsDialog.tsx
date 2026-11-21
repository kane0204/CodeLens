import { useRef, useState } from 'react';
import type { LlmSettings } from '../types';
import { useApp } from '../state/AppState';
import { Button, Modal } from './Ui';
import { logger } from '../lib/logger';

const DEEPSEEK_DOCS = 'https://api-docs.deepseek.com/zh-cn/';

export function SettingsDialog() {
  const {
    settingsOpen, settings, credentials, settingsError,
    closeSettings, saveSettings, clearStoredApiKey,
  } = useApp();

  return (
    <Modal
      open={settingsOpen}
      title="模型设置"
      subtitle="接口地址与模型名称保存在本机；API Key 保存在操作系统凭据库。"
      onClose={closeSettings}
      width={540}
      footer={<SettingsFooter onClose={closeSettings} />}
    >
      <SettingsForm settings={settings} credentials={credentials}
        settingsError={settingsError} saveSettings={saveSettings}
        clearStoredApiKey={clearStoredApiKey} />
    </Modal>
  );
}

interface SettingsFormProps {
  settings: LlmSettings;
  credentials: ReturnType<typeof useApp>['credentials'];
  settingsError: string;
  saveSettings: (settings: LlmSettings) => Promise<void>;
  clearStoredApiKey: () => Promise<void>;
}

function SettingsForm({ settings, credentials, settingsError, saveSettings, clearStoredApiKey }: SettingsFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [reveal, setReveal] = useState(false);

  return (
    <form id="llm-settings-form" ref={formRef} onSubmit={(event) => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      void saveSettings({
        baseUrl: String(fields.get('baseUrl')),
        model: String(fields.get('model')),
        apiKey: String(fields.get('apiKey')),
      });
    }}>
      <ModelFields baseUrl={settings.baseUrl} model={settings.model} />
      <DeepSeekDocs />
      <ApiKeyField apiKey={settings.apiKey} credentials={credentials}
        reveal={reveal} toggleReveal={() => setReveal((value) => !value)} />
      <SettingsError message={settingsError} />
      <SettingsActions credentials={credentials} onClearStored={clearStoredApiKey} onClear={() => {
        clearSettingsFields(formRef.current);
        setReveal(false);
      }} />
    </form>
  );
}

function clearSettingsFields(form: HTMLFormElement | null) {
  const inputs = form?.querySelectorAll('input');
  if (!inputs) return;
  for (const input of inputs) input.value = '';
  inputs[0]?.focus();
}

interface SettingsFooterProps {
  onClose: () => void;
}

function SettingsFooter({ onClose }: SettingsFooterProps) {
  return (
    <>
      <Button variant="ghost" size="sm" onClick={onClose}>
        取消
      </Button>
      <Button variant="primary" size="sm" type="submit" form="llm-settings-form">
        保存设置
      </Button>
    </>
  );
}

interface SettingsErrorProps {
  message: string;
}

function SettingsError({ message }: SettingsErrorProps) {
  if (!message) return null;
  return (
    <p className="mt-4 rounded-[4px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[11.5px] text-danger" role="alert">
      {message}
    </p>
  );
}

interface ModelFieldsProps {
  baseUrl: string;
  model: string;
}

function ModelFields({ baseUrl, model }: ModelFieldsProps) {
  return (
    <>
      <label className="block text-[11.5px] font-medium text-ink" htmlFor="llm-base-url">
        模型接口基础地址
      </label>
      <input
        id="llm-base-url"
        type="text"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        placeholder="https://api.example.com/v1"
        name="baseUrl"
        defaultValue={baseUrl}
        className="mt-1.5 h-9 w-full rounded-[4px] border border-line bg-card px-3 text-[12px] outline-none transition-colors placeholder:text-faint focus:border-primary"
      />
      <p className="mt-1 text-[10.5px] leading-relaxed text-faint">
        仅支持 HTTP / HTTPS；地址中不能包含账号、密码、查询参数或片段。
      </p>

      <label className="mt-5 block text-[11.5px] font-medium text-ink" htmlFor="llm-model">
        模型名称
      </label>
      <input
        id="llm-model"
        type="text"
        autoComplete="off"
        spellCheck={false}
        placeholder="例如 gpt-4o-mini"
        name="model"
        defaultValue={model}
        className="num mt-1.5 h-9 w-full rounded-[4px] border border-line bg-card px-3 text-[12px] outline-none transition-colors placeholder:text-faint focus:border-primary"
      />
    </>
  );
}

function DeepSeekDocs() {
  return (
    <a
      href={DEEPSEEK_DOCS}
      target="_blank"
      rel="noreferrer"
      className="mt-3 inline-flex text-[10.5px] font-medium text-primary hover:underline"
    >
      查看 DeepSeek 官方教程
    </a>
  );
}

interface ApiKeyFieldProps {
  apiKey: string;
  credentials: ReturnType<typeof useApp>['credentials'];
  reveal: boolean;
  toggleReveal: () => void;
}

function ApiKeyField({ apiKey, credentials, reveal, toggleReveal }: ApiKeyFieldProps) {
  return (
    <>
      <label className="mt-5 block text-[11.5px] font-medium text-ink" htmlFor="llm-api-key">
        API Key
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          id="llm-api-key"
          type={reveal ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          placeholder={credentials.configured ? '已安全保存；留空保持不变' : '输入 API Key'}
          name="apiKey"
          defaultValue={apiKey}
          className="api-key-input num h-9 min-w-0 flex-1 rounded-[4px] border border-line bg-card px-3 text-[12px] outline-none transition-colors placeholder:text-faint focus:border-primary"
        />
        <Button size="sm" className="h-9" aria-pressed={reveal} onClick={toggleReveal}>
          {reveal ? '隐藏' : '显示'}
        </Button>
      </div>
      <p className="mt-1 text-[10.5px] leading-relaxed text-faint">
        {credentialHint(credentials)}
      </p>
    </>
  );
}

function credentialHint(credentials: ReturnType<typeof useApp>['credentials']) {
  if (!credentials.available) {
    return '系统凭据库不可用。请重新运行 start-codelens 启动脚本安装后端依赖。';
  }
  if (credentials.configured) {
    return `已保存在 ${credentials.backend || '系统凭据库'}。输入新值可替换，留空则保持不变。`;
  }
  return `保存后会写入 ${credentials.backend || '系统凭据库'}，不会写入 localStorage 或导出报告。`;
}

interface SettingsActionsProps {
  credentials: ReturnType<typeof useApp>['credentials'];
  onClearStored: () => Promise<void>;
  onClear: () => void;
}

function SettingsActions({ credentials, onClearStored, onClear }: SettingsActionsProps) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => logger.download()}>
          下载诊断日志
        </Button>
        <span className="text-[10px] leading-relaxed text-faint">仅本机记录，不含源码与密钥</span>
      </div>
      <div className="flex items-center gap-1.5">
        {credentials.configured ? (
          <Button size="sm" variant="ghost" onClick={() => void onClearStored()}>
            清除已保存密钥
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onClear}>
          清空草稿
        </Button>
      </div>
    </div>
  );
}
