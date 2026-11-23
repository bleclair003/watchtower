/**
 * Map snapshot (v0.68.0): the map frame with a header (what, when, which layers, where) and a footer
 * with the map data credits, saved as a PNG in the viewer's own browser.
 */
export const BASEMAP_CREDIT = 'Basemap: OpenFreeMap · © OpenMapTiles · data © OpenStreetMap contributors';

export function composeSnapshot(map: HTMLCanvasElement, header: string[], footer: string[], scale = 1): HTMLCanvasElement {
  const pad = Math.round(8 * scale);
  const line = Math.round(15 * scale);
  const font = `${Math.round(11 * scale)}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
  const out = document.createElement('canvas');
  out.width = map.width;
  const ctx = out.getContext('2d')!;
  ctx.font = font;
  // Wrap each line to the image width; the first line of the header keeps its colour across wraps.
  const wrap = (lines: string[]) =>
    lines.flatMap((t, li) => {
      const rows: { text: string; first: boolean }[] = [];
      let row = '';
      const avail = out.width - pad * 2;
      // A word wider than the image (a link) is broken into pieces that fit.
      const words = t.split(' ').flatMap((w) => {
        if (ctx.measureText(w).width <= avail) return [w];
        const per = Math.max(8, Math.floor((w.length * avail) / ctx.measureText(w).width) - 1);
        return w.match(new RegExp(`.{1,${per}}`, 'g')) ?? [w];
      });
      for (const word of words) {
        const next = row ? `${row} ${word}` : word;
        if (row && ctx.measureText(next).width > avail) {
          rows.push({ text: row, first: li === 0 });
          row = word;
        } else row = next;
      }
      rows.push({ text: row, first: li === 0 });
      return rows;
    });
  const headRows = wrap(header);
  const footRows = wrap(footer);
  const head = pad * 2 + headRows.length * line;
  const foot = pad * 2 + footRows.length * line;
  out.height = map.height + head + foot;
  ctx.fillStyle = '#050a07';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(map, 0, head);
  // Resizing the canvas reset the context, so set the font again.
  ctx.font = font;
  ctx.textBaseline = 'top';
  const write = (rows: { text: string; first: boolean }[], top: number, color: string, accent: boolean) =>
    rows.forEach((r, i) => {
      ctx.fillStyle = accent && r.first ? '#6aff9b' : color;
      ctx.fillText(r.text, pad, top + pad + i * line);
    });
  write(headRows, 0, '#b7d9c3', true);
  ctx.strokeStyle = '#1f3a2a';
  ctx.beginPath();
  ctx.moveTo(0, head - 0.5);
  ctx.lineTo(out.width, head - 0.5);
  ctx.moveTo(0, head + map.height + 0.5);
  ctx.lineTo(out.width, head + map.height + 0.5);
  ctx.stroke();
  write(footRows, head + map.height, '#7f9c8a', false);
  return out;
}

export const snapshotFileName = (now: Date) => `watchtower-map-${now.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')}Z.png`;

/** Saves the canvas as a PNG download. Resolves false if the browser refused to encode it. */
export function downloadCanvas(canvas: HTMLCanvasElement, name: string): Promise<boolean> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) return resolve(false);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      resolve(true);
    }, 'image/png');
  });
}
