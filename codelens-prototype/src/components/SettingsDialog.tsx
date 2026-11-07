import { useEffect, useState } from 'react';
import { useApp } from '../state/AppState';
import { Button, Modal } from './Ui';
import { logger } from '../lib/logger';

export function SettingsDialog() {
  const { settingsOpen, settings, settingsError, closeSettings, saveSettings } = useApp();
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [model, setModel] = useState(settings.model);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    if (!settingsOpen) return;
    setBaseUrl(settings.baseUrl);
    setModel(settings.model);
    setApiKey(settings.apiKey);
    setReveal(false);
  }, [settingsOpen, settings]);

  return (
    <Modal
      open={settingsOpen}
      title="模型设置"
      subtitle="用于「逻辑说明」页的 AI 解读；配置只保存在本机浏览器。"
      onClose={closeSettings}
      width={540}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={closeSettings}>
            取消
          </Button>
          <Button variant="primary" size="sm" type="submit" form="llm-settings-form">
            保存设置
          </Button>
        </>
      }
    >
      <form
        id="llm-settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          saveSettings({ baseUrl, model, apiKey });
        }}
      >
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
          <Button size="sm" className="h-9" aria-pressed={reveal} onClick={() => setReveal((value) => !value)}>
            {reveal ? '隐藏' : '显示'}
          </Button>
        </div>
        <p className="mt-1 text-[10.5px] leading-relaxed text-faint">
          API Key 不写入 localStorage，也不会出现在导出报告中。留空则使用服务端配置。
        </p>

        {settingsError ? (
          <p className="mt-4 rounded-[4px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[11.5px] text-danger" role="alert">
            {settingsError}
          </p>
        ) : null}

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
            onClick={() => {
              setBaseUrl('');
              setModel('');
              setApiKey('');
              setReveal(false);
              document.getElementById('llm-base-url')?.focus();
            }}
          >
            清空草稿
          </Button>
        </div>
      </form>
    </Modal>
  );
}
