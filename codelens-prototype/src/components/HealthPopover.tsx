import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HealthInfo } from '../types';

const PANEL_WIDTH = 400;

export function HealthPopover({ health }: { health: HealthInfo | undefined }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<number | null>(null);

  const clearClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleClose = useCallback(() => {
    clearClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 140);
  }, []);

  const place = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const panelHeight = panelRef.current?.offsetHeight ?? 300;
    const width = Math.min(PANEL_WIDTH, window.innerWidth - 16);
    let left = rect.right - width;
    if (rect.left + width <= window.innerWidth - 8) left = rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = rect.bottom + 8;
    if (top + panelHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - panelHeight - 8);
    }
    setPos({ left, top });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    const onResize = () => place();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, place]);

  useEffect(() => () => clearClose(), []);

  const notes = health?.notes ?? [];

  return (
    <>
      <span
        className="inline-flex"
        onMouseEnter={() => {
          clearClose();
          setOpen(true);
        }}
        onMouseLeave={scheduleClose}
      >
        <button
          ref={buttonRef}
          type="button"
          aria-label="查看健康度计算方式"
          aria-expanded={open}
          className="inline-flex h-[17px] w-[17px] items-center justify-center rounded-full border border-[#cdb795] bg-[#fdfbf8] text-[10px] font-semibold leading-none text-primary transition-colors hover:border-primary hover:bg-tint"
          onClick={() => setOpen((value) => !value)}
          onFocus={() => {
            clearClose();
            setOpen(true);
          }}
          onBlur={(event) => {
            const next = event.relatedTarget as Node | null;
            if (next && (panelRef.current?.contains(next) || buttonRef.current?.contains(next))) return;
            scheduleClose();
          }}
        >
          ?
        </button>
      </span>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              role="tooltip"
              className="scroll-thin fixed z-[60] max-h-[min(70vh,520px)] overflow-auto rounded-[7px] border border-line bg-card p-4 text-[12px] leading-relaxed shadow-[0_18px_44px_#2925241f] animate-fade"
              style={{ left: pos.left, top: pos.top, width: Math.min(PANEL_WIDTH, window.innerWidth - 16) }}
              onMouseEnter={clearClose}
              onMouseLeave={scheduleClose}
            >
              <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-line pb-2">
                <h3 className="serif text-[13px] font-semibold text-ink">健康度计算方式</h3>
                <span className="num text-[11px] text-muted">
                  {health?.score ?? '—'} · {health?.grade ?? '—'}
                </span>
              </div>
              <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted">公式</p>
              <p className="num mb-3 break-words text-[11.5px] text-ink">{health?.formula || '引擎未提供公式'}</p>
              <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted">口径</p>
              <p className="mb-3 text-[11.5px] text-ink">{health?.basis || '引擎未提供口径说明'}</p>
              {notes.length ? (
                <>
                  <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted">说明</p>
                  <ul className="list-disc space-y-1 pl-4 text-[11.5px] text-[#57534e]">
                    {notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
