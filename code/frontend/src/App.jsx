import { useEffect } from "react";
import { mountLegacyWorkbench } from "../app.js";

function LensMark({ size = 34 }) {
  return (
    <span
      className="lens-mark"
      style={{ "--lens-size": `${size}px` }}
      aria-hidden="true"
    >
      <span className="lens-mark__core" />
    </span>
  );
}

function BootScreen() {
  return (
    <main className="boot-screen" aria-busy="true" aria-live="polite">
      <div className="boot-screen__identity">
        <LensMark size={48} />
        <span>CodeLens</span>
      </div>
      <div className="boot-screen__copy">
        <p>正在准备代码工作台…</p>
        <span>连接本机静态分析服务…</span>
      </div>
      <div className="boot-screen__track" aria-hidden="true">
        <span />
      </div>
    </main>
  );
}

function WorkbenchRuntime() {
  useEffect(() => {
    return mountLegacyWorkbench();
  }, []);

  return null;
}

function ConfirmDialog() {
  return (
    <dialog id="confirm-dialog" aria-labelledby="confirm-title">
      <h2 id="confirm-title">重新导入项目</h2>
      <p>新分析会替换当前工作区。需要时，仍可从上一份结果返回查看。</p>
      <div className="actions">
        <button
          type="button"
          data-action="close-dialog"
          aria-label="取消重新导入"
        >
          取消
        </button>
        <button
          type="button"
          className="primary"
          data-action="confirm-import"
          aria-label="确认重新导入"
        >
          继续导入
        </button>
      </div>
    </dialog>
  );
}

function DetailDialog() {
  return (
    <dialog
      id="detail-dialog"
      className="wide-dialog"
      aria-label="详细内容"
    />
  );
}

function SettingsDialog() {
  return (
    <dialog
      id="settings-dialog"
      className="settings-dialog"
      aria-labelledby="settings-title"
    >
      <form id="llm-settings-form">
        <div className="heading">
          <div>
            <p className="dialog-kicker">模型连接</p>
            <h2 id="settings-title">AI 解读设置</h2>
          </div>
          <button
            type="button"
            className="text"
            data-action="settings-close"
            aria-label="关闭设置"
          >
            关闭
          </button>
        </div>
        <h3>兼容 OpenAI Chat Completions 的模型</h3>
        <p className="muted">
          只有在生成“AI 逻辑解读”时，选中的源码才会发送到模型服务。
        </p>
        <label htmlFor="llm-base-url">接口地址（Base URL）</label>
        <input
          id="llm-base-url"
          aria-label="大模型接口地址"
          name="baseUrl"
          type="url"
          placeholder="https://your-provider.example/v1"
          autoComplete="off"
          spellCheck="false"
          aria-describedby="llm-url-help"
        />
        <small id="llm-url-help">
          填写供应商提供的兼容接口根地址。
        </small>
        <label htmlFor="llm-model">模型名称</label>
        <input
          id="llm-model"
          aria-label="模型名称"
          name="model"
          type="text"
          placeholder="填写模型 ID…"
          autoComplete="off"
          spellCheck="false"
          maxLength="200"
        />
        <label htmlFor="llm-api-key">API Key</label>
        <div className="key-field">
          <input
            id="llm-api-key"
            aria-label="API Key"
            name="apiKey"
            type="password"
            placeholder="输入密钥…"
            autoComplete="off"
            spellCheck="false"
            aria-describedby="llm-key-help"
          />
          <button
            type="button"
            data-action="settings-key-toggle"
            aria-label="显示 API Key"
            aria-pressed="false"
          >
            显示
          </button>
        </div>
        <small id="llm-key-help">
          密钥只保存在当前页面内存中，刷新页面后会自动清除。
        </small>
        <p className="footnote">
          接口地址和模型名称只保存在当前浏览器；密钥不会写入本地存储。
        </p>
        <p id="settings-error" className="critical" role="alert" hidden />
        <div className="actions">
          <button
            type="button"
            className="text danger"
            data-action="settings-clear"
            aria-label="清空设置"
          >
            清空
          </button>
          <button
            type="button"
            data-action="settings-close"
            aria-label="取消设置"
          >
            取消
          </button>
          <button type="submit" className="primary" aria-label="保存设置">
            保存设置
          </button>
        </div>
      </form>
    </dialog>
  );
}

export default function App() {
  return (
    <>
      <a className="skip" href="#main" aria-label="跳到主要内容">
        跳到主要内容
      </a>
      <div id="app">
        <BootScreen />
      </div>
      <input
        id="folder-input"
        type="file"
        webkitdirectory=""
        multiple
        hidden
        aria-label="选择 Python 项目文件夹"
      />
      <div
        id="toasts"
        className="toasts"
        aria-live="polite"
        aria-atomic="false"
      />
      <ConfirmDialog />
      <DetailDialog />
      <SettingsDialog />
      <noscript>需要启用 JavaScript 才能使用本代码分析工作台。</noscript>
      <WorkbenchRuntime />
    </>
  );
}
