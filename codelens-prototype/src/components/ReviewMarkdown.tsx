import type { ReactNode } from 'react';
import { useApp } from '../state/AppState';
import type { ExplainCitation } from '../types';

const CITATION = /\[([^\]\n]+?):L(\d+)(?:-L?(\d+))?\]/g;

function renderPlain(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={`${keyPrefix}-b-${index}`} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={`${keyPrefix}-t-${index}`}>{part}</span>;
  });
}

function InlineText({ text, citations }: { text: string; citations: ExplainCitation[] }) {
  const { openSource } = useApp();
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  for (const match of text.matchAll(CITATION)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(...renderPlain(text.slice(cursor, start), `p-${index}`));
    const file = match[1];
    const line = Number(match[2]);
    const endLine = Number(match[3] ?? match[2]);
    const citation = citations.find(
      (item) => item.valid && item.file === file && item.line === line && item.end_line === endLine,
    );
    if (citation) {
      nodes.push(
        <button
          key={`c-${index}`}
          type="button"
          className="num rounded-[3px] bg-tint px-1 py-0 text-[0.9em] text-primary transition-colors hover:bg-[#eadbc4] hover:underline"
          title="查看源码"
          onClick={() => openSource({ title: '源码引用', path: file, line, endLine })}
        >
          {file}:L{line}{endLine !== line ? `–${endLine}` : ''}
        </button>,
      );
    } else {
      nodes.push(
        <span key={`c-${index}`} className="num text-faint">
          {file}:L{line}{endLine !== line ? `–${endLine}` : ''}
        </span>,
      );
    }
    cursor = start + match[0].length;
    index += 1;
  }
  if (cursor < text.length) nodes.push(...renderPlain(text.slice(cursor), `tail-${index}`));
  return <>{nodes}</>;
}

export function ReviewMarkdown({ markdown, citations }: { markdown: string; citations: ExplainCitation[] }) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join(' ');
    blocks.push(
      <p key={`p-${blocks.length}`} className="text-[12.5px] leading-[1.85] text-[#57534e]">
        <InlineText text={text} citations={citations} />
      </p>,
    );
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="space-y-1.5">
        {list.map((item, itemIndex) => (
          <li key={itemIndex} className="flex gap-2 text-[12.5px] leading-[1.75] text-[#57534e]">
            <span className="mt-[0.72em] h-1 w-1 shrink-0 rounded-full bg-primary" />
            <span className="min-w-0">
              <InlineText text={item} citations={citations} />
            </span>
          </li>
        ))}
      </ul>,
    );
    list = [];
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      return;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(
        <h3
          key={`h-${blocks.length}`}
          className={`serif font-semibold text-ink ${level <= 2 ? 'mt-1 text-[16px]' : 'text-[13.5px]'}`}
        >
          <InlineText text={heading[2]} citations={citations} />
        </h3>,
      );
      return;
    }
    const bullet = line.match(/^(?:[-*•]|\d+[.、])\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      return;
    }
    flushList();
    paragraph.push(line);
  });
  flushParagraph();
  flushList();

  return <div className="space-y-3">{blocks}</div>;
}
