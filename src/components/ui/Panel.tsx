import type { ReactNode } from 'react';

interface PanelProps {
  title: string;
  /** Short designator shown before the title, e.g. "A1". */
  designator?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}

/** Standard bordered console panel with a title strip. */
export function Panel({ title, designator, actions, children, className = '', bodyClassName = '', id }: PanelProps) {
  return (
    <section
      id={id}
      aria-label={title}
      className={`flex min-h-0 flex-col border border-wt-line bg-wt-panel ${className}`}
    >
      {/* When the title and actions do not fit on one line, the actions take their own line and wrap onto more lines,
          so they never spill past the panel (v0.61.1: the GOC map toolbar overflowed at 1920 px). */}
      <header className="flex min-h-7 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-wt-line bg-wt-bg2 px-2 py-1">
        {designator && <span className="text-2xs text-wt-fg-dim">{designator}</span>}
        <h2 className="glow min-w-0 font-display text-xs tracking-[0.18em] text-wt-fg uppercase">{title}</h2>
        {actions && <div className="ml-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-1">{actions}</div>}
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
