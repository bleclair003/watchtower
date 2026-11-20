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
      <header className="flex h-7 shrink-0 items-center gap-2 border-b border-wt-line bg-wt-bg2 px-2">
        {designator && <span className="text-2xs text-wt-fg-dim">{designator}</span>}
        <h2 className="glow font-display text-xs tracking-[0.18em] text-wt-fg uppercase">{title}</h2>
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
