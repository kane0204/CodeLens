import { useEffect, useState } from 'react';
import type { LlmSettings } from '../types';
import { useApp } from '../state/AppState';
import { Button, Modal } from './Ui';
import { logger } from '../lib/logger';

export function SettingsDialog() {
  const { settingsOpen, settings, settingsError, closeSettings, saveSettings } = useApp();
  const { draft, reveal, updateField, clearDraft, toggleReveal } = useSettingsDraft(settingsOpen, settings);

  return (
    <Modal
      open={settingsOpen}
      title="模型设置"
      subtitle="用于「逻辑说明」页的 AI 解读；配置只保存在本机浏览器。"
      onClose={closeSettings}
      width={540}
      footer={<SettingsFooter onClose={closeSettings} />}
    >
      <form
        id="llm-settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          saveSettings(draft);
        }}
      >
        <ModelFields
          baseUrl={draft.baseUrl}
          model={draft.model}
          setBaseUrl={(value) => updateField('baseUrl', value)}
          setModel={(value) => updateField('model', value)}
        />
        <ApiKeyField
          apiKey={draft.apiKey}
          setApiKey={(value) => updateField('apiKey', value)}
          reveal={reveal}
          toggleReveal={toggleReveal}
        />
        <SettingsError message={settingsError} />
        <SettingsActions onClear={clearDraft} />
      </form>
    </Modal>
  );
}

function useSettingsDraft(settingsOpen: boolean, settings: LlmSettings) {
  const [draft, setDraft] = useState(settings);
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    if (!settingsOpen) return;
    setDraft(settings);
    setReveal(false);
  }, [settingsOpen, settings]);

  function updateField(key: keyof LlmSettings, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function clearDraft() {
    setDraft({ baseUrl: '', model: '', apiKey: '' });
    setReveal(false);
    document.getElementById('llm-base-url')?.focus();
  }

  return { draft, reveal, updateField, clearDraft, toggleReveal: () => setReveal((value) => !value) };
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
  setBaseUrl: (value: string) => void;
  setModel: (value: string) => void;
}

function ModelFields({ baseUrl, model, setBaseUrl, setModel }: ModelFieldsProps) {
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
        value={baseUrl}
        onChange={(event) => setBaseUrl(event.target.value)}
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
        value={model}
        onChange={(event) => setModel(event.target.value)}
        className="num mt-1.5 h-9 w-full rounded-[4px] border border-line bg-card px-3 text-[12px] outline-none transition-colors placeholder:text-faint focus:border-primary"
      />
    </>
  );
}

interface ApiKeyFieldProps {
  apiKey: string;
  setApiKey: (value: string) => void;
  reveal: boolean;
  toggleReveal: () => void;
}

function ApiKeyField({ apiKey, setApiKey, reveal, toggleReveal }: ApiKeyFieldProps) {
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
          placeholder="仅保存在当前页面内存中"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          className="num h-9 min-w-0 flex-1 rounded-[4px] border border-line bg-card px-3 text-[12px] outline-none transition-colors placeholder:text-faint focus:border-primary"
        />
        <Button size="sm" className="h-9" aria-pressed={reveal} onClick={toggleReveal}>
          {reveal ? '隐藏' : '显示'}
        </Button>
      </div>
      <p className="mt-1 text-[10.5px] leading-relaxed text-faint">
        API Key 不写入 localStorage，也不会出现在导出报告中。留空则使用服务端配置。
      </p>
    </>
  );
}

function SettingsActions({ onClear }: { onClear: () => void }) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => logger.download()}>
          下载诊断日志
        </Button>
        <span className="text-[10px] leading-relaxed text-faint">仅本机记录，不含源码与密钥</span>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={onClear}
      >
        清空草稿
      </Button>
    </div>
  );
}
