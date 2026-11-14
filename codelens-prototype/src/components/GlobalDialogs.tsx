import type { SourceTarget } from '../state/AppState';
import { useApp } from '../state/AppState';
import { Icon } from './Icon';
import { Button, Modal } from './Ui';

export function SourceDialog() {
  const { sourceTarget: target, closeSource, result } = useApp();
  const file = result?.files.find((item) => item.path === target?.path);

  return (
    <Modal
      open={Boolean(target)}
      title={target?.title ?? '源码'}
      subtitle={target && <SourceLocation target={target} />}
      onClose={closeSource}
      width={860}
      footer={
        <Button variant="ghost" size="sm" onClick={closeSource}>
          关闭
        </Button>
      }
    >
      {!target || !file ? (
        <p className="text-[12px] text-muted">分析结果中没有该文件的源码。</p>
      ) : (
        <>
          <SourceLines source={file.source} start={target.line} end={target.endLine} />
          <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-faint">
            <Icon name="info" size={12} />
            引用来自本次提交给引擎的源码，超出范围的引用不会被标记为有效。
          </p>
        </>
      )}
    </Modal>
  );
}

function SourceLocation({ target }: { target: SourceTarget }) {
  return (
    <span className="num">
      {target.path}:{target.line}–{target.endLine}
    </span>
  );
}


interface SourceLinesProps {
  source: string;
  start: number;
  end: number;
}

function SourceLines({ source, start, end }: SourceLinesProps) {
  return (
    <div className="scroll-thin max-h-[56vh] overflow-auto rounded-[4px] border border-line bg-[#fdfbf8] py-2">
      <div className="source-block">
        {source.split('\n').map((line, index) => {
          const number = index + 1;
          const inRange = number >= start && number <= end;
          return (
            <div key={number} className={`source-line ${inRange ? 'hl' : ''}`}>
              <span className="ln">{number}</span>
              <code>{line || ' '}</code>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ConfirmReimportDialog() {
  const { confirmReimport, cancelReimport, confirmReimportAction } = useApp();
  return (
    <Modal
      open={confirmReimport}
      title="重新导入项目"
      onClose={cancelReimport}
      width={440}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={cancelReimport}>
            取消
          </Button>
          <Button size="sm" variant="primary" onClick={confirmReimportAction}>
            确认重新导入
          </Button>
        </>
      }
    >
      <p className="text-[12.5px] leading-relaxed text-[#57534e]">
        将返回导入页并重新读取文件夹。当前分析结果仍会保留，可在导入页点击「查看上一次结果」返回。
      </p>
    </Modal>
  );
}

const toastTone = {
  info: 'border-l-primary',
  success: 'border-l-success',
  warning: 'border-l-warning',
  error: 'border-l-danger',
} as const;

export function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[70] flex w-[min(92vw,440px)] -translate-x-1/2 flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`animate-fade rounded-[4px] border border-line border-l-[3px] bg-card px-3.5 py-2 text-[11.5px] text-ink shadow-[0_8px_24px_#29252414] ${toastTone[toast.kind]}`}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
