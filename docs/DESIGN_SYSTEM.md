# Design System

Tokens are defined once in `src/index.css` (`@theme`) and used as Tailwind classes.

## Colour

| Token | Hex | Class | Use |
|---|---|---|---|
| `wt-bg` | #050A08 | `bg-wt-bg` | App background |
| `wt-bg2` | #0B1511 | `bg-wt-bg2` | Title strips, hover |
| `wt-panel` | #07100C | `bg-wt-panel` | Panel bodies |
| `wt-line` / `wt-line-strong` | #18301F / #24503A | `border-wt-line` | Dividers / emphasized borders |
| `wt-fg` | #6AFF9B | `text-wt-fg` | Primary text (phosphor) |
| `wt-fg-muted` | #80A992 | `text-wt-fg-muted` | Secondary text |
| `wt-fg-dim` | #4C6B5A | `text-wt-fg-dim` | Labels, captions |
| `wt-warn` | #FFC857 | `text-wt-warn` | Warnings, DEMO marking, unverified |
| `wt-crit` | #FF5555 | `text-wt-crit` | Critical / failure only |
| `wt-info` | #69C6D5 | `text-wt-info` | Selection, official statements, focus ring |
| `wt-inactive` | #65746C | `text-wt-inactive` | Not configured / not deployed |

**Rules:** red and amber are reserved for status and severity and are never category colours. Selection is always cyan. "Not built yet" is always slate gray, never green.

## Typography

- **IBM Plex Mono** (400/500/600): all body and data text, base 13 px.
- **Share Tech Mono**: panel titles and the wordmark only.
- `text-2xs` (10 px) for labels; `tabular-nums` on every number and time.

## Category symbols

Shape-coded so they work without colour: Military ▲, Diplomatic ●, Aviation ◆, Maritime ▼, Cyber ■, Unrest ✚, Disaster ⬢, Economic ⬟, Other official ▬. Defined once as SVG paths in `src/config/categories.ts`. The map rasterizes the same paths, so the legend always matches.

## Components

`Panel` (titled bordered box with designator), `Tag` (bordered uppercase label, tone-coded), `Lamp` (status square), `CategoryGlyph`.

## Effects

Scanlines (default on), glow (on), flicker (off). All are toggled in Settings. Flicker and pulses are suppressed under `prefers-reduced-motion`.

## Map

Base style is OpenFreeMap "dark", recoloured by `militarizeStyle()`. Watch areas are dashed boxes, labelled `CODE · n AREA-LEVEL` when they hold reports without precise coordinates.
