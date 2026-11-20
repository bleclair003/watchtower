import type { ReactNode } from 'react';
import type { Tone } from '../../config/categories';

const TONE_CLASSES: Record<Tone, string> = {
  ok: 'border-wt-fg/50 text-wt-fg',
  info: 'border-wt-info/60 text-wt-info',
  warn: 'border-wt-warn/70 text-wt-warn',
  crit: 'border-wt-crit/70 text-wt-crit',
  muted: 'border-wt-line-strong text-wt-fg-muted',
  inactive: 'border-wt-inactive/50 text-wt-inactive',
};

/** Compact bordered status label. */
export function Tag({ tone = 'muted', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex h-4 shrink-0 items-center border px-1 text-2xs leading-none tracking-wider uppercase ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Status lamp. `pulse` animates only when motion is allowed. */
export function Lamp({ tone, pulse = false, label }: { tone: Tone; pulse?: boolean; label: string }) {
  const color: Record<Tone, string> = {
    ok: 'bg-wt-fg',
    info: 'bg-wt-info',
    warn: 'bg-wt-warn',
    crit: 'bg-wt-crit',
    muted: 'bg-wt-fg-muted',
    inactive: 'bg-wt-inactive',
  };
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-block size-2 shrink-0 ${color[tone]} ${pulse ? 'motion-safe:animate-pulse' : ''}`}
    />
  );
}
