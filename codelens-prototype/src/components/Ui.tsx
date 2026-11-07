import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
import { SEVERITY_LABEL, severityBadgeClass } from '../lib/format';
import type { Severity } from '../types';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const variantClass: Record<Variant, string> = {
  primary:
    'border-primary bg-primary text-white hover:bg-primary-hover hover:border-primary-hover shadow-[0_1px_0_#00000008]',
  secondary: 'border-line bg-card text-ink hover:border-primary/50 hover:bg-[#fdfbf8]',
  ghost: 'border-transparent bg-transparent text-primary hover:bg-tint/60',
  danger: 'border-[#fecaca] bg-card text-danger hover:bg-[#fef2f2]',
};

const sizeClass: Record<Size, string> = {
  sm: 'h-6.5 px-2 text-[11px] gap-1',
  md: 'h-8 px-3 text-xs gap-1.5',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 items-center justify-center rounded-[4px] border font-medium transition-colors disabled:pointer-events-none ${variantClass[variant]} ${sizeClass[size]} ${className}`}
      {...rest}
    >
      {icon ? <Icon name={icon} size={size === 'sm' ? 12 : 13} /> : null}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  size?: number;
  active?: boolean;
}

export function IconButton({ icon, label, size = 15, active = false, className = '', ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
        active
          ? 'border-primary/40 bg-tint text-primary'
          : 'border-transparent text-muted hover:border-line hover:bg-card hover:text-ink'
      } ${className}`}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <section
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[6px] border border-line bg-card shadow-[0_1px_2px_#0000000d] ${className}`}
    >
      {children}
    </section>
  );
}

interface CardHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: IconName;
  actions?: ReactNode;
  className?: string;
}

export function CardHeader({ title, subtitle, icon, actions, className = '' }: CardHeaderProps) {
  return (
    <header
      className={`flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 ${className}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        {icon ? <Icon name={icon} size={14} className="shrink-0 text-primary" /> : null}
        <h2 className="serif truncate text-[13px] font-semibold tracking-[0.01em] text-ink">{title}</h2>
        {subtitle ? <span className="truncate text-[11px] text-muted">{subtitle}</span> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </header>
  );
}

export function Badge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded-[3px] border px-1.5 text-[10px] font-semibold tracking-wide ${severityBadgeClass(
        severity,
      )}`}
    >
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'primary' | 'success' | 'warning' }) {
  const map = {
    neutral: 'border-line bg-[#f7f4ef] text-[#57534e]',
    primary: 'border-[#e2cfb3] bg-tint text-primary',
    success: 'border-[#bbf7d0] bg-[#f0fdf4] text-success',
    warning: 'border-[#fed7aa] bg-[#fff7ed] text-warning',
  };
  return (
    <span className={`inline-flex h-5 shrink-0 items-center rounded-[3px] border px-1.5 text-[10px] font-medium ${map[tone]}`}>
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  hint,
  action,
  compact = false,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 text-center ${compact ? 'px-4 py-6' : 'px-6 py-10'}`}>
      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-paper text-faint">
        <Icon name="info" size={15} />
      </span>
      <p className="text-[12px] font-medium text-muted">{title}</p>
      {hint ? <p className="max-w-[38ch] text-[11px] leading-relaxed text-faint">{hint}</p> : null}
      {action}
    </div>
  );
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#eee7db]" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

interface ModalProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  subtitle?: ReactNode;
}

export function Modal({ open, title, onClose, children, footer, width = 560, subtitle }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="关闭弹窗"
        className="absolute inset-0 bg-[#292524]/28 backdrop-blur-[1px] animate-fade"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className="relative flex max-h-[86vh] w-full flex-col overflow-hidden rounded-[8px] border border-line bg-card shadow-[0_24px_60px_#29252424] animate-fade"
        style={{ maxWidth: width }}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="serif text-[16px] font-semibold text-ink">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-[11px] text-muted">{subtitle}</p> : null}
          </div>
          <IconButton icon="x" label="关闭" onClick={onClose} />
        </header>
        <div className="scroll-thin min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer ? <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-[#fdfbf8] px-5 py-3">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
