import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logger } from '../lib/logger';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  errorId: string;
}

/** Last-resort UI guard: a render crash must not leave a blank screen. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorId: '' };

  static getDerivedStateFromError(error: Error): State {
    return { error, errorId: Math.random().toString(36).slice(2, 10) };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    logger.error('react', 'render_crash', {
      message: error.message,
      error_id: this.state.errorId,
    });
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#faf7f2] px-6">
        <div className="w-full max-w-[520px] rounded-[8px] border border-[#e7dfd3] bg-white px-6 py-7 shadow-[0_2px_10px_#00000012]">
          <h1 className="serif text-[18px] font-semibold text-[#292524]">界面遇到问题</h1>
          <p className="mt-2 text-[12px] leading-relaxed text-[#78716c]">
            当前操作已停止。日志只记录在本机浏览器内存中，不会上传；可下载后定位问题，再重新加载界面。
          </p>
          <p className="num mt-3 text-[11px] text-[#a8a29e]">错误编号：{this.state.errorId}</p>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              className="rounded-[4px] bg-[#8b5e34] px-3 py-1.5 text-[11.5px] font-medium text-white hover:opacity-90"
              onClick={() => logger.download()}
            >
              下载日志
            </button>
            <button
              type="button"
              className="rounded-[4px] border border-[#e7dfd3] px-3 py-1.5 text-[11.5px] text-[#292524] hover:bg-[#faf7f2]"
              onClick={() => window.location.reload()}
            >
              重新加载
            </button>
          </div>
        </div>
      </div>
    );
  }
}
