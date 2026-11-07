import { useEffect, useRef } from 'react';
import { useApp } from '../state/AppState';
import { FileTree } from '../components/FileTree';
import { Icon } from '../components/Icon';
import { ReviewMarkdown } from '../components/ReviewMarkdown';
import { Button, Card, CardHeader, EmptyState } from '../components/Ui';

export function LogicView() {
  const {
    result,
    file,
    highlight,
    aiReview,
    reviewBusy,
    reviewProgress,
    reviewError,
    selectFile,
    runReview,
    cancelReview,
    copyText,
    openSettings,
    treeSearch,
    setTreeSearch,
  } = useApp();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const targetFile = result?.files.find((item) => item.path === file) ?? result?.files[0];
  const section = aiReview?.sections.logic;

  useEffect(() => {
    if (!highlight || !scrollRef.current) return;
    const container = scrollRef.current;
    const line = container.querySelector<HTMLElement>(`[data-line="${highlight.start}"]`);
    if (!line) return;
    const top = line.offsetTop - container.clientHeight / 2 + line.clientHeight;
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [highlight, targetFile?.path, section]);

  if (!result) return null;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="min-h-0">
        <CardHeader title="项目文件" icon="folder" actions={<span className="num text-[10px] text-faint">{result.files.length}</span>} />
        <FileTree
          files={result.files}
          classes={result.classes}
          selected={targetFile?.path ?? ''}
          search={treeSearch}
          onSearch={setTreeSearch}
          onSelect={selectFile}
        />
      </Card>

      <Card className="min-h-0">
        <CardHeader
          title="AI 逻辑解读"
          icon="code"
          subtitle="全项目一次生成 · 模块间互为说明"
          actions={
            <Button size="sm" variant="ghost" icon="settings" onClick={openSettings}>
              模型设置
            </Button>
          }
        />

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-[#fdfbf8] px-3 py-2">
          <Button
            size="sm"
            variant="primary"
            icon="play"
            onClick={() => void runReview()}
            disabled={reviewBusy}
          >
            {section ? '重新生成解读' : '一键解读整个项目'}
          </Button>
          {reviewBusy ? (
            <Button size="sm" variant="danger" icon="stop" onClick={cancelReview}>
              取消
            </Button>
          ) : null}
          {section ? (
            <Button size="sm" variant="ghost" icon="copy" onClick={() => void copyText(section.markdown)}>
              复制解读
            </Button>
          ) : null}
          {reviewBusy && reviewProgress ? (
            <span className="num text-[10px] text-primary">
              {reviewProgress.label || (reviewProgress.stage === 'read' ? '阅读源码' : '生成审查')} · {reviewProgress.done}/{reviewProgress.total}
            </span>
          ) : null}
          {highlight ? (
            <span className="num ml-auto text-[10px] text-primary">
              已定位 L{highlight.start}
              {highlight.end !== highlight.start ? `–${highlight.end}` : ''}
            </span>
          ) : null}
        </div>

        <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 overflow-auto px-4 py-3">
          {reviewError ? (
            <div className="mb-3 max-w-[860px] rounded-[4px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[11.5px] leading-relaxed text-danger" role="alert">
              {reviewError}
            </div>
          ) : null}

          {reviewBusy && !section ? (
            <div className="max-w-[860px] rounded-[6px] border border-dashed border-[#ddd4c8] bg-[#faf8f4] px-5 py-8" role="status">
              <div className="mb-3 h-1.5 w-40 animate-pulse rounded bg-[#e9e2d6]" />
              <p className="text-[12.5px] font-medium text-ink">AI 正在通读项目源码…</p>
              <p className="mt-1 text-[11px] text-muted">
                {reviewProgress?.label ?? '分批阅读后会交叉核对，生成覆盖逻辑、设计与风险的综合解读'}
              </p>
            </div>
          ) : section ? (
            <div className="max-w-[900px]">
              <ReviewMarkdown markdown={section.markdown} citations={section.citations} />
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2.5 text-[10.5px] text-faint">
                <span className="num">模型：{aiReview?.model || '—'}</span>
                <span className="num">
                  覆盖 {aiReview?.source_files ?? 0} 个已解析文件{aiReview && aiReview.batch_count > 1 ? ` · ${aiReview.batch_count} 批` : ''}
                </span>
                <span>解读基于完整源码与静态分析事实，点击引用回到源码核对</span>
              </div>
              {aiReview?.omitted_context ? (
                <p className="mt-2 rounded-[4px] border border-[#fed7aa] bg-[#fff7ed] px-3 py-1.5 text-[10.5px] text-warning">
                  部分静态事实超出上下文上限，未全部发送。
                </p>
              ) : null}
              {aiReview?.truncated ? (
                <p className="mt-2 rounded-[4px] border border-[#fed7aa] bg-[#fff7ed] px-3 py-1.5 text-[10.5px] text-warning">
                  模型输出达到长度限制，内容可能不完整，可重新生成。
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="w-full max-w-[620px] rounded-[6px] border border-dashed border-[#ddd4c8] bg-[#faf8f4] px-6 py-7">
                <h3 className="serif text-[15px] font-semibold text-ink">一键生成全项目逻辑解读</h3>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
                  AI 通读全部已解析源码，串起入口、主流程与模块协作，同一份审查同时供给「设计检查」「风险评估」，互为说明。
                </p>
                <ul className="mt-3 space-y-1.5 text-[11px] leading-relaxed text-muted">
                  {['项目做什么、入口与主流程', '模块之间如何协作、数据如何流转', '异常边界与需要人工复核的地方'].map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-primary" />
                      {item}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[10.5px] text-faint">
                  在初始化页或「模型设置」中配置接口与模型；导入时配置好会自动生成。
                </p>
              </div>
            </div>
          )}

          {targetFile?.source != null ? (
            <details className="mt-4 border-t border-line pt-3" open={Boolean(highlight)}>
              <summary className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
                <Icon name="chevronRight" size={11} />
                查看原始源码 · {targetFile.path}
              </summary>
              <div className="scroll-thin mt-2 max-h-[320px] overflow-auto rounded-[4px] border border-line bg-[#fdfbf8] py-1.5">
                <div className="source-block">
                  {targetFile.source.split('\n').map((line, index) => {
                    const number = index + 1;
                    const active = highlight ? number >= highlight.start && number <= highlight.end : false;
                    return (
                      <div key={number} data-line={number} className={`source-line ${active ? 'hl' : ''}`}>
                        <span className="ln">{number}</span>
                        <code>{line || ' '}</code>
                      </div>
                    );
                  })}
                </div>
              </div>
            </details>
          ) : (
            <EmptyState compact title="分析结果不含源码" hint="该文件未被解析或源码未随响应返回。" />
          )}
        </div>
      </Card>
    </div>
  );
}
