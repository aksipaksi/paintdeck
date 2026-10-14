// Own rasterisation so pencil, lines and shapes stay hard-edged like Paint.
// Everything is drawn with integer fillRect calls, which canvas never anti-aliases.

import { STAGE_H, STAGE_W, type Rect } from './types';

type Ctx = CanvasRenderingContext2D;

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function emptyBox(): BBox {
  return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
}

export function growBox(b: BBox, x0: number, y0: number, x1: number, y1: number) {
  if (x0 < b.x0) b.x0 = x0;
  if (y0 < b.y0) b.y0 = y0;
  if (x1 > b.x1) b.x1 = x1;
  if (y1 > b.y1) b.y1 = y1;
}

/** Converts an inclusive pixel box to a rect clipped to the stage, or null when empty. */
export function boxToRect(b: BBox): Rect | null {
  const x0 = Math.max(0, Math.floor(b.x0));
  const y0 = Math.max(0, Math.floor(b.y0));
  const x1 = Math.min(STAGE_W - 1, Math.ceil(b.x1));
  const y1 = Math.min(STAGE_H - 1, Math.ceil(b.y1));
  if (x1 < x0 || y1 < y0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function bresenham(x0: number, y0: number, x1: number, y1: number, plot: (x: number, y: number) => void) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

const discCache = new Map<number, [number, number][]>();

/** Row spans [xStart, xEndExclusive] of a hard-edged disc with the given diameter. */
function discSpans(d: number): [number, number][] {
  let spans = discCache.get(d);
  if (spans) return spans;
  spans = [];
  const r = d / 2;
  for (let i = 0; i < d; i++) {
    const yc = i + 0.5 - r;
    const half = Math.sqrt(Math.max(0, r * r - yc * yc));
    let xl = Math.round(r - half);
    let xr = Math.round(r + half);
    if (xr <= xl) {
      xl = Math.floor(r);
      xr = xl + 1;
    }
    spans.push([xl, xr]);
  }
  discCache.set(d, spans);
  return spans;
}

export type TipShape = 'round' | 'square';

/** Stamps a tip of diameter `d` centred on pixel (cx, cy). Returns the touched box. */
export function stamp(ctx: Ctx, cx: number, cy: number, d: number, shape: TipShape, box?: BBox) {
  const ox = Math.round(cx) - Math.floor(d / 2);
  const oy = Math.round(cy) - Math.floor(d / 2);
  if (d <= 1) {
    ctx.fillRect(ox, oy, 1, 1);
  } else if (shape === 'square') {
    ctx.fillRect(ox, oy, d, d);
  } else {
    const spans = discSpans(d);
    for (let i = 0; i < spans.length; i++) {
      const [xl, xr] = spans[i];
      ctx.fillRect(ox + xl, oy + i, xr - xl, 1);
    }
  }
  if (box) growBox(box, ox, oy, ox + d - 1, oy + d - 1);
}

export function strokeLine(
  ctx: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  d: number,
  shape: TipShape,
  box?: BBox,
) {
  bresenham(x0, y0, x1, y1, (x, y) => stamp(ctx, x, y, d, shape, box));
}

/** Span function: for row y returns inclusive [xl, xr] or null when the row is outside the shape. */
type SpanFn = (y: number) => [number, number] | null;

function ellipseSpanFn(x0: number, y0: number, x1: number, y1: number): SpanFn {
  const cx = (x0 + x1 + 1) / 2;
  const cy = (y0 + y1 + 1) / 2;
  const rx = (x1 - x0 + 1) / 2;
  const ry = (y1 - y0 + 1) / 2;
  return (y) => {
    if (y < y0 || y > y1) return null;
    const yc = (y + 0.5 - cy) / ry;
    const dx = rx * Math.sqrt(Math.max(0, 1 - yc * yc));
    const xl = Math.round(cx - dx);
    const xr = Math.max(xl, Math.round(cx + dx) - 1);
    return [xl, xr];
  };
}

function roundRectSpanFn(x0: number, y0: number, x1: number, y1: number, r: number): SpanFn {
  r = Math.max(0, Math.min(r, (x1 - x0 + 1) / 2, (y1 - y0 + 1) / 2));
  return (y) => {
    if (y < y0 || y > y1) return null;
    let dy = 0;
    if (y < y0 + r) dy = y0 + r - (y + 0.5);
    else if (y > y1 - r) dy = y + 0.5 - (y1 + 1 - r);
    const inset = dy > 0 ? Math.round(r - Math.sqrt(Math.max(0, r * r - dy * dy))) : 0;
    return [x0 + inset, x1 - inset];
  };
}

function rectSpanFn(x0: number, y0: number, x1: number, y1: number): SpanFn {
  return (y) => (y < y0 || y > y1 ? null : [x0, x1]);
}

export type ShapeKind = 'rect' | 'ellipse' | 'roundrect';

function spanFnFor(kind: ShapeKind, x0: number, y0: number, x1: number, y1: number, inset: number): SpanFn | null {
  const a = x0 + inset;
  const b = y0 + inset;
  const c = x1 - inset;
  const d = y1 - inset;
  if (c < a || d < b) return null;
  if (kind === 'rect') return rectSpanFn(a, b, c, d);
  if (kind === 'ellipse') return ellipseSpanFn(a, b, c, d);
  const baseR = Math.min(40, Math.max(12, Math.min(x1 - x0, y1 - y0) / 6));
  return roundRectSpanFn(a, b, c, d, Math.max(0, baseR - inset));
}

/**
 * Draws a shape into the inclusive box (x0,y0)-(x1,y1).
 * `stroke` paints the outline of width `w`, `fill` paints the interior; either may be null.
 */
export function drawShape(
  ctx: Ctx,
  kind: ShapeKind,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  w: number,
  stroke: string | null,
  fill: string | null,
): BBox {
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  const outer = spanFnFor(kind, x0, y0, x1, y1, 0)!;
  const inner = stroke ? spanFnFor(kind, x0, y0, x1, y1, w) : outer;
  for (let y = y0; y <= y1; y++) {
    const o = outer(y);
    if (!o) continue;
    const i = inner ? inner(y) : null;
    if (stroke) {
      ctx.fillStyle = stroke;
      if (!i) ctx.fillRect(o[0], y, o[1] - o[0] + 1, 1);
      else {
        if (i[0] > o[0]) ctx.fillRect(o[0], y, i[0] - o[0], 1);
        if (o[1] > i[1]) ctx.fillRect(i[1] + 1, y, o[1] - i[1], 1);
      }
    }
    if (fill && i) {
      ctx.fillStyle = fill;
      ctx.fillRect(i[0], y, i[1] - i[0] + 1, 1);
    }
  }
  return { x0, y0, x1, y1 };
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

/**
 * Scanline flood fill with tolerance 0 on a Uint32 view of `img` (assumes little-endian RGBA).
 * Mutates `img` and returns the filled box, or null when nothing changed.
 */
export function floodFill(img: ImageData, sx: number, sy: number, hex: string): BBox | null {
  const w = img.width;
  const h = img.height;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  const px = new Uint32Array(img.data.buffer, img.data.byteOffset, w * h);
  const [r, g, b] = hexToRgb(hex);
  const color = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  const target = px[sy * w + sx];
  if (target === color) return null;
  const box = emptyBox();
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    const row = y * w;
    if (px[row + x] !== target) continue;
    let xl = x;
    while (xl > 0 && px[row + xl - 1] === target) xl--;
    let xr = x;
    while (xr < w - 1 && px[row + xr + 1] === target) xr++;
    px.fill(color, row + xl, row + xr + 1);
    growBox(box, xl, y, xr, y);
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= h) continue;
      const nrow = ny * w;
      let inRun = false;
      for (let nx = xl; nx <= xr; nx++) {
        const match = px[nrow + nx] === target;
        if (match && !inRun) {
          stack.push(nx, ny);
          inRun = true;
        } else if (!match) inRun = false;
      }
    }
  }
  return box;
}

/** Copies a sub-rectangle out of a full-stage ImageData. */
export function cropImageData(src: ImageData, r: Rect): ImageData {
  const out = new ImageData(r.w, r.h);
  const s = new Uint32Array(src.data.buffer, src.data.byteOffset, src.width * src.height);
  const d = new Uint32Array(out.data.buffer);
  for (let y = 0; y < r.h; y++) {
    const start = (r.y + y) * src.width + r.x;
    d.set(s.subarray(start, start + r.w), y * r.w);
  }
  return out;
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function clipRect(r: Rect): Rect | null {
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(STAGE_W, Math.ceil(r.x + r.w));
  const y1 = Math.min(STAGE_H, Math.ceil(r.y + r.h));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
