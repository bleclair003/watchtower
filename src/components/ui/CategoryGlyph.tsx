import type { EventCategory } from '@shared/domain/types';
import { CATEGORY_STYLES } from '../../config/categories';

/** Inline SVG of a category's map symbol (same path the map rasterizes). */
export function CategoryGlyph({ category, size = 12 }: { category: EventCategory; size?: number }) {
  const s = CATEGORY_STYLES[category];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={s.label}
      className="shrink-0"
    >
      <title>{s.label}</title>
      <path d={s.path} fill="rgb(106 255 155 / 0.18)" stroke="currentColor" strokeWidth={2.5} strokeLinejoin="miter" />
    </svg>
  );
}
