import {
  addBlob,
  blobUrl,
  cloneGifs,
  currentSlide,
  deck,
  emit,
  markChanged,
  nextGifZ,
  on,
  pushGifUndo,
  pushPaintUndo,
  pushUndo,
  uid,
} from './deck';
import {
  boxToRect,
  clipRect,
  cropImageData,
  drawShape,
  emptyBox,
  floodFill,
  growBox,
  rgbToHex,
  strokeLine,
  unionRect,
  type BBox,
  type ShapeKind,
  type TipShape,
} from './raster';
import { STAGE_H, STAGE_W, type FillMode, type GifObj, type Rect, type ToolId } from './types';

export const settings = {
  tool: 'pencil' as ToolId,
  prevTool: 'pencil' as ToolId,
  primary: '#000000',
  secondary: '#ffffff',
  brushShape: 'round' as TipShape,
  brushSize: 8,
  eraserSize: 16,
  lineWidth: 3,
  fillMode: 'outline' as FillMode,
  airSize: 24,
  font: 'Arial',
  fontSize: 64,
  bold: false,
  italic: false,
  textOpaque: false,
};

export const GIF_WARN_BYTES = 20 * 1024 * 1024;

type Corner = 'nw' | 'ne' | 'sw' | 'se';

interface Floating {
  src: HTMLCanvasElement;
  x: number;
  y: number;
  w: number;
  h: number;
  before: ImageData;
  liftRect: Rect | null;
}

interface TextEdit {
  el: HTMLTextAreaElement;
  x: number;
  y: number;
  w: number;
}

type Drag =
  | { kind: 'stroke'; before: ImageData; box: BBox; last: [number, number]; color: string; timer?: number; pos: [number, number] }
  | { kind: 'shape'; tool: ToolId; start: [number, number]; end: [number, number]; stroke: string; fill: string; shift: boolean }
  | { kind: 'marquee'; start: [number, number] }
  | { kind: 'floatMove'; dx: number; dy: number }
  | { kind: 'resize'; target: 'float' | 'gif'; corner: Corner; orig: Rect; moved: boolean }
  | { kind: 'gifMove'; id: string; dx: number; dy: number; before: GifObj[]; moved: boolean }
  | { kind: 'textBox'; start: [number, number]; end: [number, number] };

const hooks = {
  onCursor: (_x: number | null, _y: number | null) => {},
  onHint: (_msg: string) => {},
  onToolChange: () => {},
  onColorsChange: () => {},
  onSelectionChange: () => {},
  onGifContextMenu: (_clientX: number, _clientY: number) => {},
};
export function setEditorHooks(h: Partial<typeof hooks>) {
  Object.assign(hooks, h);
}

let workspace: HTMLElement;
let stageWrap: HTMLElement;
let stage: HTMLElement;
let preview: HTMLCanvasElement;
let pctx: CanvasRenderingContext2D;
let gifLayer: HTMLElement;
let marqueeEl: HTMLElement;
let gifBoxEl: HTMLElement;
let floatEl: HTMLElement;
let mountedCanvas: HTMLCanvasElement | null = null;

export const view = { scale: 0.5 };

let marquee: Rect | null = null;
let floating: Floating | null = null;
let selectedGif: string | null = null;
let text: TextEdit | null = null;
let drag: Drag | null = null;
let internalClipboard: HTMLCanvasElement | null = null;
const gifEls = new Map<string, HTMLImageElement>();

export function getSelectionInfo() {
  return {
    marquee,
    floating: floating ? { x: floating.x, y: floating.y, w: floating.w, h: floating.h } : null,
    selectedGif,
    editingText: !!text,
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

function addHandles(box: HTMLElement) {
  for (const c of ['nw', 'ne', 'sw', 'se']) el('div', `handle ${c}`, box);
}

export function mountEditor(ws: HTMLElement) {
  workspace = ws;
  stageWrap = el('div', 'stage-wrap', ws);
  stage = el('div', 'stage', stageWrap);
  preview = el('canvas', 'preview-layer', stage);
  preview.width = STAGE_W;
  preview.height = STAGE_H;
  pctx = preview.getContext('2d')!;
  gifLayer = el('div', 'gif-layer', stage);
  marqueeEl = el('div', 'marquee', stage);
  gifBoxEl = el('div', 'sel-box gif-box', stage);
  addHandles(gifBoxEl);
  floatEl = el('div', 'sel-box float-box', stage);
  addHandles(floatEl);

  new ResizeObserver(fit).observe(ws);
  fit();

  stageWrap.addEventListener('pointerdown', onPointerDown);
  stageWrap.addEventListener('pointermove', onPointerMove);
  stageWrap.addEventListener('pointerup', onPointerUp);
  stageWrap.addEventListener('pointercancel', onPointerUp);
  stageWrap.addEventListener('pointerleave', () => hooks.onCursor(null, null));
  stageWrap.addEventListener('contextmenu', (e) => e.preventDefault());
  // Clicking the grey area around the stage commits whatever is floating, like Paint.
  ws.addEventListener('pointerdown', (e) => {
    if (e.target === ws) commitPending();
  });
  setupDrop(ws);

  on('current', () => showCurrentSlide());
  on('gifs', (s) => {
    if (s === currentSlide()) {
      if (selectedGif && !s.gifs.some((g) => g.id === selectedGif)) selectedGif = null;
      syncGifs();
    }
  });
  showCurrentSlide();
}

function fit() {
  const pad = 24;
  const w = workspace.clientWidth - pad * 2;
  const h = workspace.clientHeight - pad * 2;
  view.scale = Math.max(0.05, Math.min(w / STAGE_W, h / STAGE_H));
  stageWrap.style.width = `${Math.round(STAGE_W * view.scale)}px`;
  stageWrap.style.height = `${Math.round(STAGE_H * view.scale)}px`;
  stage.style.transform = `scale(${view.scale})`;
  stage.style.setProperty('--inv', String(1 / view.scale));
}

export function showCurrentSlide() {
  const slide = currentSlide();
  if (!slide || !stage) return;
  if (mountedCanvas !== slide.canvas) {
    mountedCanvas?.remove();
    stage.insertBefore(slide.canvas, stage.firstChild);
    mountedCanvas = slide.canvas;
  }
  marquee = null;
  selectedGif = null;
  pctx.clearRect(0, 0, STAGE_W, STAGE_H);
  syncGifs();
  renderSelection();
}

export function syncGifs() {
  const slide = currentSlide();
  const seen = new Set<string>();
  for (const g of slide.gifs) {
    seen.add(g.id);
    let img = gifEls.get(g.id);
    if (!img) {
      img = new Image();
      img.draggable = false;
      img.className = 'gif-obj';
      gifEls.set(g.id, img);
    }
    const url = blobUrl(g.blobId);
    if (img.dataset.blob !== g.blobId) {
      img.src = url;
      img.dataset.blob = g.blobId;
    }
    Object.assign(img.style, { left: `${g.x}px`, top: `${g.y}px`, width: `${g.w}px`, height: `${g.h}px`, zIndex: String(g.z) });
    if (img.parentElement !== gifLayer) gifLayer.appendChild(img);
  }
  for (const [id, img] of gifEls) {
    if (!seen.has(id)) {
      img.remove();
      gifEls.delete(id);
    }
  }
  renderSelection();
}

function place(e: HTMLElement, r: { x: number; y: number; w: number; h: number } | null) {
  if (!r) {
    e.style.display = 'none';
    return;
  }
  Object.assign(e.style, { display: 'block', left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
}

function renderSelection() {
  place(marqueeEl, floating ? null : marquee);
  place(gifBoxEl, selectedGif ? currentSlide().gifs.find((g) => g.id === selectedGif) ?? null : null);
  if (floating) {
    place(floatEl, floating);
    if (floatEl.firstChild !== floating.src) {
      floatEl.querySelector('canvas')?.remove();
      floatEl.insertBefore(floating.src, floatEl.firstChild);
    }
  } else {
    place(floatEl, null);
    floatEl.querySelector('canvas')?.remove();
  }
  hooks.onSelectionChange();
}

function toStage(e: PointerEvent | MouseEvent | DragEvent): [number, number] {
  const r = stageWrap.getBoundingClientRect();
  return [(e.clientX - r.left) / view.scale, (e.clientY - r.top) / view.scale];
}

function snapshot(): ImageData {
  return currentSlide().ctx.getImageData(0, 0, STAGE_W, STAGE_H);
}

export function setTool(t: ToolId) {
  if (t === settings.tool) return;
  commitPending();
  if (t !== 'select') {
    marquee = null;
    selectedGif = null;
    renderSelection();
  }
  if (t === 'eyedropper') settings.prevTool = settings.tool;
  settings.tool = t;
  updateCursor(null);
  hooks.onToolChange();
}

export function setColor(which: 'primary' | 'secondary', hex: string) {
  settings[which] = hex;
  if (text) applyTextStyle();
  hooks.onColorsChange();
}

function hitRect(r: { x: number; y: number; w: number; h: number }, x: number, y: number) {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

function hitCorner(r: { x: number; y: number; w: number; h: number }, x: number, y: number): Corner | null {
  const tol = 10 / view.scale;
  const corners: [Corner, number, number][] = [
    ['nw', r.x, r.y],
    ['ne', r.x + r.w, r.y],
    ['sw', r.x, r.y + r.h],
    ['se', r.x + r.w, r.y + r.h],
  ];
  for (const [c, cx, cy] of corners) if (Math.abs(x - cx) <= tol && Math.abs(y - cy) <= tol) return c;
  return null;
}

function gifAt(x: number, y: number): GifObj | null {
  const sorted = [...currentSlide().gifs].sort((a, b) => b.z - a.z);
  return sorted.find((g) => hitRect(g, x, y)) ?? null;
}

function onPointerDown(e: PointerEvent) {
  if (text && e.target === text.el) return;
  if (e.button !== 0 && e.button !== 2) return;
  e.preventDefault();
  const [x, y] = toStage(e);
  const right = e.button === 2;
  const tool = settings.tool;

  if (text) {
    commitText();
    return;
  }

  if (floating) {
    const c = hitCorner(floating, x, y);
    if (c && !right) {
      startDrag(e, { kind: 'resize', target: 'float', corner: c, orig: { ...floating }, moved: false });
      return;
    }
    if (hitRect(floating, x, y) && !right) {
      startDrag(e, { kind: 'floatMove', dx: x - floating.x, dy: y - floating.y });
      return;
    }
    commitFloating();
    if (tool !== 'select') return;
  }

  if (tool === 'select') {
    const sel = selectedGif ? currentSlide().gifs.find((g) => g.id === selectedGif) : null;
    if (sel && !right) {
      const c = hitCorner(sel, x, y);
      if (c) {
        startDrag(e, { kind: 'resize', target: 'gif', corner: c, orig: { ...sel }, moved: false });
        return;
      }
    }
    const g = gifAt(x, y);
    if (g) {
      selectedGif = g.id;
      marquee = null;
      renderSelection();
      if (right) hooks.onGifContextMenu(e.clientX, e.clientY);
      else startDrag(e, { kind: 'gifMove', id: g.id, dx: x - g.x, dy: y - g.y, before: cloneGifs(currentSlide().gifs), moved: false });
      return;
    }
    selectedGif = null;
    if (marquee && hitRect(marquee, x, y) && !right) {
      liftMarquee(e.ctrlKey || e.metaKey || e.altKey);
      startDrag(e, { kind: 'floatMove', dx: x - floating!.x, dy: y - floating!.y });
      return;
    }
    marquee = null;
    renderSelection();
    if (!right) startDrag(e, { kind: 'marquee', start: [x, y] });
    return;
  }

  const slide = currentSlide();
  const fg = right ? settings.secondary : settings.primary;
  const bg = right ? settings.primary : settings.secondary;
  const px = Math.floor(x);
  const py = Math.floor(y);

  switch (tool) {
    case 'eyedropper': {
      if (px < 0 || py < 0 || px >= STAGE_W || py >= STAGE_H) return;
      const d = slide.ctx.getImageData(px, py, 1, 1).data;
      setColor(right ? 'secondary' : 'primary', rgbToHex(d[0], d[1], d[2]));
      setTool(settings.prevTool === 'eyedropper' ? 'pencil' : settings.prevTool);
      return;
    }
    case 'fill': {
      if (px < 0 || py < 0 || px >= STAGE_W || py >= STAGE_H) return;
      const img = snapshot();
      const before = new ImageData(new Uint8ClampedArray(img.data), STAGE_W, STAGE_H);
      const box = floodFill(img, px, py, fg);
      if (!box) return;
      const rect = boxToRect(box)!;
      slide.ctx.putImageData(img, 0, 0, rect.x, rect.y, rect.w, rect.h);
      pushPaintUndo(slide, rect, before);
      return;
    }
    case 'pencil':
    case 'brush':
    case 'eraser':
    case 'airbrush': {
      const color = tool === 'eraser' ? settings.secondary : fg;
      const d: Drag = { kind: 'stroke', before: snapshot(), box: emptyBox(), last: [px, py], color, pos: [px, py] };
      startDrag(e, d);
      if (tool === 'airbrush') {
        spray(d);
        d.timer = window.setInterval(() => spray(d), 25);
      } else strokeTo(d, px, py);
      return;
    }
    case 'line':
    case 'rect':
    case 'ellipse':
    case 'roundrect':
      startDrag(e, { kind: 'shape', tool, start: [px, py], end: [px, py], stroke: fg, fill: bg, shift: e.shiftKey });
      drawShapePreview();
      return;
    case 'text':
      startDrag(e, { kind: 'textBox', start: [px, py], end: [px, py] });
      return;
  }
}

function startDrag(e: PointerEvent, d: Drag) {
  drag = d;
  try {
    stageWrap.setPointerCapture(e.pointerId);
  } catch {
    /* pointer already gone */
  }
}

function tipFor(tool: ToolId): [number, TipShape] {
  if (tool === 'pencil') return [1, 'square'];
  if (tool === 'eraser') return [settings.eraserSize, 'square'];
  return [settings.brushSize, settings.brushShape];
}

function strokeTo(d: Extract<Drag, { kind: 'stroke' }>, x: number, y: number) {
  const ctx = currentSlide().ctx;
  ctx.fillStyle = d.color;
  const [size, shape] = tipFor(settings.tool);
  strokeLine(ctx, d.last[0], d.last[1], x, y, size, shape, d.box);
  d.last = [x, y];
}

function spray(d: Extract<Drag, { kind: 'stroke' }>) {
  const ctx = currentSlide().ctx;
  ctx.fillStyle = d.color;
  const r = settings.airSize / 2;
  const n = Math.max(10, Math.round(r * 1.2));
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(Math.random()) * r;
    ctx.fillRect(Math.round(d.pos[0] + Math.cos(a) * rr), Math.round(d.pos[1] + Math.sin(a) * rr), 1, 1);
  }
  growBox(d.box, d.pos[0] - r - 1, d.pos[1] - r - 1, d.pos[0] + r + 1, d.pos[1] + r + 1);
}

function snapLine(sx: number, sy: number, ex: number, ey: number): [number, number] {
  const dx = ex - sx;
  const dy = ey - sy;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ay < ax * 0.414) return [ex, sy];
  if (ax < ay * 0.414) return [sx, ey];
  const m = Math.max(ax, ay);
  return [sx + Math.sign(dx) * m, sy + Math.sign(dy) * m];
}

function shapeEnd(d: Extract<Drag, { kind: 'shape' }>): [number, number] {
  const [sx, sy] = d.start;
  let [ex, ey] = d.end;
  if (!d.shift) return [ex, ey];
  if (d.tool === 'line') return snapLine(sx, sy, ex, ey);
  const m = Math.max(Math.abs(ex - sx), Math.abs(ey - sy));
  return [sx + (ex >= sx ? m : -m), sy + (ey >= sy ? m : -m)];
}

function renderShape(ctx: CanvasRenderingContext2D, d: Extract<Drag, { kind: 'shape' }>): BBox {
  const [sx, sy] = d.start;
  const [ex, ey] = shapeEnd(d);
  const w = settings.lineWidth;
  if (d.tool === 'line') {
    ctx.fillStyle = d.stroke;
    const box = emptyBox();
    strokeLine(ctx, sx, sy, ex, ey, w, 'round', box);
    return box;
  }
  const mode = settings.fillMode;
  const stroke = mode === 'fill' ? null : d.stroke;
  const fill = mode === 'outline' ? null : mode === 'fill' ? d.stroke : d.fill;
  return drawShape(ctx, d.tool as ShapeKind, sx, sy, ex, ey, w, stroke, fill);
}

function drawShapePreview() {
  if (drag?.kind !== 'shape') return;
  pctx.clearRect(0, 0, STAGE_W, STAGE_H);
  renderShape(pctx, drag);
}

function resizeRect(orig: Rect, corner: Corner, x: number, y: number, keepRatio: boolean): Rect {
  const ax = corner.includes('w') ? orig.x + orig.w : orig.x;
  const ay = corner.includes('n') ? orig.y + orig.h : orig.y;
  let w = Math.max(4, Math.abs(x - ax));
  let h = Math.max(4, Math.abs(y - ay));
  if (keepRatio) {
    const s = Math.max(w / orig.w, h / orig.h);
    w = Math.max(4, orig.w * s);
    h = Math.max(4, orig.h * s);
  }
  const nx = corner.includes('w') ? ax - w : ax;
  const ny = corner.includes('n') ? ay - h : ay;
  return { x: Math.round(nx), y: Math.round(ny), w: Math.round(w), h: Math.round(h) };
}

function onPointerMove(e: PointerEvent) {
  const [x, y] = toStage(e);
  hooks.onCursor(Math.floor(x), Math.floor(y));
  if (!drag) {
    updateCursor([x, y]);
    return;
  }
  const d = drag;
  switch (d.kind) {
    case 'stroke': {
      if (settings.tool === 'airbrush') {
        d.pos = [Math.floor(x), Math.floor(y)];
        break;
      }
      const events = e.getCoalescedEvents?.() ?? [e];
      for (const ce of events.length ? events : [e]) {
        const [cx, cy] = toStage(ce);
        strokeTo(d, Math.floor(cx), Math.floor(cy));
      }
      break;
    }
    case 'shape':
      d.end = [Math.floor(x), Math.floor(y)];
      d.shift = e.shiftKey;
      drawShapePreview();
      break;
    case 'marquee': {
      const r = normRect(d.start[0], d.start[1], x, y);
      marquee = clipRect(r);
      renderSelection();
      break;
    }
    case 'floatMove':
      if (floating) {
        floating.x = Math.round(x - d.dx);
        floating.y = Math.round(y - d.dy);
        renderSelection();
      }
      break;
    case 'resize': {
      const r = resizeRect(d.orig, d.corner, x, y, e.shiftKey);
      if (d.target === 'float' && floating) Object.assign(floating, r);
      else if (d.target === 'gif') {
        const g = currentSlide().gifs.find((g) => g.id === selectedGif);
        if (g) {
          if (!d.moved) pushUndo(currentSlide(), { kind: 'gifs', gifs: cloneGifs(currentSlide().gifs) });
          Object.assign(g, r);
          syncGifs();
        }
      }
      d.moved = true;
      renderSelection();
      break;
    }
    case 'gifMove': {
      const g = currentSlide().gifs.find((g) => g.id === d.id);
      if (!g) break;
      const nx = Math.round(x - d.dx);
      const ny = Math.round(y - d.dy);
      if (!d.moved && (nx !== g.x || ny !== g.y)) {
        d.moved = true;
        pushUndo(currentSlide(), { kind: 'gifs', gifs: d.before });
      }
      g.x = nx;
      g.y = ny;
      syncGifs();
      break;
    }
    case 'textBox': {
      d.end = [Math.floor(x), Math.floor(y)];
      marquee = normRect(d.start[0], d.start[1], d.end[0], d.end[1]);
      renderSelection();
      break;
    }
  }
}

function normRect(ax: number, ay: number, bx: number, by: number): Rect {
  const x = Math.floor(Math.min(ax, bx));
  const y = Math.floor(Math.min(ay, by));
  return { x, y, w: Math.ceil(Math.max(ax, bx)) - x, h: Math.ceil(Math.max(ay, by)) - y };
}

function onPointerUp(e: PointerEvent) {
  const d = drag;
  drag = null;
  if (!d) return;
  const slide = currentSlide();
  switch (d.kind) {
    case 'stroke':
      clearInterval(d.timer);
      pushPaintUndo(slide, boxToRect(d.box), d.before);
      break;
    case 'shape': {
      pctx.clearRect(0, 0, STAGE_W, STAGE_H);
      const before = snapshot();
      const box = renderShape(slide.ctx, d);
      pushPaintUndo(slide, boxToRect(box), before);
      break;
    }
    case 'marquee':
      if (marquee && (marquee.w < 2 || marquee.h < 2)) marquee = null;
      renderSelection();
      break;
    case 'resize':
      if (d.target === 'gif' && d.moved) markChanged(slide, false);
      break;
    case 'gifMove':
      if (d.moved) markChanged(slide, false);
      break;
    case 'textBox': {
      marquee = null;
      renderSelection();
      const r = normRect(d.start[0], d.start[1], d.end[0], d.end[1]);
      const w = r.w > 30 ? r.w : Math.min(900, STAGE_W - r.x);
      startText(r.x, r.y, Math.max(60, w));
      break;
    }
  }
  try {
    stageWrap.releasePointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
}

function updateCursor(p: [number, number] | null) {
  let cursor = settings.tool === 'text' ? 'text' : settings.tool === 'select' ? 'default' : 'crosshair';
  if (p) {
    const [x, y] = p;
    const sel = selectedGif ? currentSlide().gifs.find((g) => g.id === selectedGif) : null;
    const box = floating ?? (settings.tool === 'select' ? sel : null);
    const c = box ? hitCorner(box, x, y) : null;
    if (c) cursor = c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize';
    else if (floating && hitRect(floating, x, y)) cursor = 'move';
    else if (settings.tool === 'select' && (gifAt(x, y) || (marquee && hitRect(marquee, x, y)))) cursor = 'move';
  }
  stageWrap.style.cursor = cursor;
}

// ---- floating selections -------------------------------------------------

function liftMarquee(copy: boolean) {
  if (!marquee) return;
  const slide = currentSlide();
  const r = marquee;
  const src = document.createElement('canvas');
  src.width = r.w;
  src.height = r.h;
  src.getContext('2d')!.drawImage(slide.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  const before = snapshot();
  if (!copy) {
    slide.ctx.fillStyle = settings.secondary;
    slide.ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  floating = { src, ...r, before, liftRect: copy ? null : { ...r } };
  marquee = null;
  renderSelection();
}

function makeFloat(src: HTMLCanvasElement, cx?: number, cy?: number) {
  commitPending();
  if (settings.tool !== 'select') setTool('select');
  let w = src.width;
  let h = src.height;
  const s = Math.min(1, STAGE_W / w, STAGE_H / h);
  w = Math.round(w * s);
  h = Math.round(h * s);
  const x = cx === undefined ? Math.round((STAGE_W - w) / 2) : Math.round(cx - w / 2);
  const y = cy === undefined ? Math.round((STAGE_H - h) / 2) : Math.round(cy - h / 2);
  floating = { src, x, y, w, h, before: snapshot(), liftRect: null };
  marquee = null;
  selectedGif = null;
  renderSelection();
}

export function commitFloating() {
  if (!floating) return;
  const f = floating;
  floating = null;
  const slide = currentSlide();
  const ctx = slide.ctx;
  const scaled = f.w !== f.src.width || f.h !== f.src.height;
  ctx.imageSmoothingEnabled = scaled;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(f.src, f.x, f.y, f.w, f.h);
  ctx.imageSmoothingEnabled = false;
  const dest = clipRect({ x: f.x, y: f.y, w: f.w, h: f.h });
  pushPaintUndo(slide, unionRect(f.liftRect, dest), f.before);
  marquee = null;
  renderSelection();
}

function discardFloating() {
  if (!floating) return;
  const f = floating;
  floating = null;
  if (f.liftRect) pushPaintUndo(currentSlide(), f.liftRect, f.before);
  renderSelection();
}

// ---- text tool -----------------------------------------------------------

function fontString(size = settings.fontSize) {
  return `${settings.italic ? 'italic ' : ''}${settings.bold ? 'bold ' : ''}${size}px "${settings.font}"`;
}

function lineHeight() {
  return Math.round(settings.fontSize * 1.2);
}

export function applyTextStyle() {
  if (!text) return;
  const s = text.el.style;
  s.font = fontString();
  s.lineHeight = `${lineHeight()}px`;
  s.color = settings.primary;
  s.background = settings.textOpaque ? settings.secondary : 'transparent';
  autosizeText();
}

function autosizeText() {
  if (!text) return;
  text.el.style.height = '0px';
  text.el.style.height = `${Math.max(lineHeight(), text.el.scrollHeight)}px`;
}

function startText(x: number, y: number, w: number) {
  const ta = el('textarea', 'text-edit', stage);
  ta.spellcheck = false;
  Object.assign(ta.style, { left: `${x}px`, top: `${y}px`, width: `${w}px` });
  text = { el: ta, x, y, w };
  applyTextStyle();
  ta.addEventListener('input', autosizeText);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      commitText();
    }
  });
  hooks.onSelectionChange();
  requestAnimationFrame(() => ta.focus());
}

function wrapLines(ctx: CanvasRenderingContext2D, value: string, width: number): string[] {
  const out: string[] = [];
  for (const para of value.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      const tryLine = line + word;
      if (ctx.measureText(tryLine).width <= width || !line) {
        if (ctx.measureText(tryLine).width > width && !line) {
          // A single word wider than the box: break it per character, like the textarea does.
          let chunk = '';
          for (const ch of word) {
            if (ctx.measureText(chunk + ch).width > width && chunk) {
              out.push(chunk);
              chunk = ch;
            } else chunk += ch;
          }
          line = chunk;
        } else line = tryLine;
      } else {
        out.push(line.replace(/\s+$/, ''));
        line = /^\s+$/.test(word) ? '' : word;
      }
    }
    out.push(line.replace(/\s+$/, ''));
  }
  return out;
}

export function commitText() {
  if (!text) return;
  const t = text;
  text = null;
  const value = t.el.value;
  const height = t.el.offsetHeight;
  t.el.remove();
  hooks.onSelectionChange();
  if (!value.trim()) return;
  const slide = currentSlide();
  const ctx = slide.ctx;
  const before = snapshot();
  ctx.save();
  ctx.font = fontString();
  const lines = wrapLines(ctx, value, t.w);
  const lh = lineHeight();
  const total = Math.max(height, lines.length * lh);
  if (settings.textOpaque) {
    ctx.fillStyle = settings.secondary;
    ctx.fillRect(t.x, t.y, t.w, total);
  }
  const m = ctx.measureText('Mg');
  const asc = m.fontBoundingBoxAscent ?? settings.fontSize * 0.9;
  const desc = m.fontBoundingBoxDescent ?? settings.fontSize * 0.22;
  ctx.fillStyle = settings.primary;
  ctx.textBaseline = 'alphabetic';
  let maxW = 0;
  lines.forEach((line, i) => {
    const top = t.y + i * lh;
    ctx.fillText(line, t.x, top + (lh - (asc + desc)) / 2 + asc);
    maxW = Math.max(maxW, ctx.measureText(line).width);
  });
  ctx.restore();
  const rect = clipRect({ x: t.x - 4, y: t.y - 4, w: Math.max(t.w, maxW) + 8, h: total + 8 });
  pushPaintUndo(slide, rect, before);
}

/** Stamps any pending text or floating selection; call before tool, slide or mode changes. */
export function commitPending() {
  commitText();
  commitFloating();
  if (drag?.kind === 'stroke') clearInterval(drag.timer);
}

export function clearSelection() {
  commitPending();
  marquee = null;
  selectedGif = null;
  renderSelection();
}

// ---- edit commands -------------------------------------------------------

export function selectAll() {
  commitPending();
  setTool('select');
  marquee = { x: 0, y: 0, w: STAGE_W, h: STAGE_H };
  selectedGif = null;
  renderSelection();
}

export function deleteSelection(): boolean {
  if (floating) {
    discardFloating();
    return true;
  }
  if (selectedGif) {
    deleteGif();
    return true;
  }
  if (marquee) {
    const slide = currentSlide();
    const before = snapshot();
    slide.ctx.fillStyle = settings.secondary;
    slide.ctx.fillRect(marquee.x, marquee.y, marquee.w, marquee.h);
    pushPaintUndo(slide, marquee, before);
    marquee = null;
    renderSelection();
    return true;
  }
  return false;
}

function selectionCanvas(): HTMLCanvasElement | null {
  if (floating) {
    const c = document.createElement('canvas');
    c.width = floating.w;
    c.height = floating.h;
    const cx = c.getContext('2d')!;
    cx.imageSmoothingEnabled = true;
    cx.drawImage(floating.src, 0, 0, floating.w, floating.h);
    return c;
  }
  if (marquee) {
    const c = document.createElement('canvas');
    c.width = marquee.w;
    c.height = marquee.h;
    c.getContext('2d')!.drawImage(currentSlide().canvas, marquee.x, marquee.y, marquee.w, marquee.h, 0, 0, marquee.w, marquee.h);
    return c;
  }
  return null;
}

export function copySelection(): boolean {
  const c = selectionCanvas();
  if (!c) return false;
  internalClipboard = c;
  try {
    const blob = new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej()), 'image/png'));
    void navigator.clipboard?.write?.([new ClipboardItem({ 'image/png': blob })]).catch(() => {});
  } catch {
    /* system clipboard unavailable (file://); internal clipboard still works */
  }
  hooks.onHint('Copied selection');
  return true;
}

export function cutSelection(): boolean {
  if (!copySelection()) return false;
  deleteSelection();
  return true;
}

export function pasteInternal(): boolean {
  if (!internalClipboard) return false;
  const c = document.createElement('canvas');
  c.width = internalClipboard.width;
  c.height = internalClipboard.height;
  c.getContext('2d')!.drawImage(internalClipboard, 0, 0);
  makeFloat(c, internalClipboard.width / 2 + 20, internalClipboard.height / 2 + 20);
  return true;
}

export function hasInternalClipboard() {
  return !!internalClipboard;
}

export function clearImage() {
  commitPending();
  const slide = currentSlide();
  const before = snapshot();
  slide.ctx.fillStyle = settings.secondary;
  slide.ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  pushPaintUndo(slide, { x: 0, y: 0, w: STAGE_W, h: STAGE_H }, before);
  marquee = null;
  renderSelection();
}

export function commitOrDeselect() {
  if (text) commitText();
  else if (floating) commitFloating();
  else {
    marquee = null;
    selectedGif = null;
    renderSelection();
  }
}

export function hasFloating() {
  return !!floating;
}

// ---- images and GIFs -----------------------------------------------------

export async function insertImageBlob(blob: Blob, at?: [number, number]): Promise<void> {
  if (blob.type === 'image/gif') return addGif(blob, at);
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  makeFloat(c, at?.[0], at?.[1]);
  hooks.onHint('Drag to move, corners to resize (Shift keeps ratio). Enter or click outside to stamp.');
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image'));
    img.src = url;
  });
}

export async function addGif(blob: Blob, at?: [number, number]) {
  commitPending();
  const blobId = addBlob(blob);
  const img = await loadImage(blobUrl(blobId));
  let w = img.naturalWidth || 200;
  let h = img.naturalHeight || 200;
  const s = Math.min(1, (STAGE_W * 0.8) / w, (STAGE_H * 0.8) / h);
  w = Math.round(w * s);
  h = Math.round(h * s);
  const cx = at?.[0] ?? STAGE_W / 2;
  const cy = at?.[1] ?? STAGE_H / 2;
  const slide = currentSlide();
  pushGifUndo(slide);
  const g: GifObj = { id: uid(), blobId, x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h, z: nextGifZ(slide) };
  slide.gifs.push(g);
  if (settings.tool !== 'select') setTool('select');
  selectedGif = g.id;
  marquee = null;
  markChanged(slide, false);
  syncGifs();
  hooks.onHint(
    blob.size > GIF_WARN_BYTES
      ? `Heads up: this GIF is ${(blob.size / 1048576).toFixed(0)} MB. Big GIFs can stutter when presenting.`
      : 'GIF added. Drag to move, corners to resize (Shift keeps ratio), right-click for more.',
  );
}

export function selectedGifObj(): GifObj | null {
  return selectedGif ? (currentSlide().gifs.find((g) => g.id === selectedGif) ?? null) : null;
}

export function deleteGif() {
  const slide = currentSlide();
  if (!selectedGif) return;
  pushGifUndo(slide);
  slide.gifs = slide.gifs.filter((g) => g.id !== selectedGif);
  selectedGif = null;
  markChanged(slide, false);
  syncGifs();
}

export function moveGifZ(dir: 1 | -1) {
  const slide = currentSlide();
  const g = selectedGifObj();
  if (!g) return;
  const sorted = [...slide.gifs].sort((a, b) => a.z - b.z);
  const i = sorted.indexOf(g);
  const j = i + dir;
  if (j < 0 || j >= sorted.length) return;
  pushGifUndo(slide);
  [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  sorted.forEach((x, k) => {
    const live = slide.gifs.find((y) => y.id === x.id)!;
    live.z = k + 1;
  });
  markChanged(slide, false);
  syncGifs();
}

export function stampGif() {
  const slide = currentSlide();
  const g = selectedGifObj();
  const img = g ? gifEls.get(g.id) : null;
  if (!g || !img) return;
  const before = snapshot();
  const gifsBefore = cloneGifs(slide.gifs);
  slide.ctx.imageSmoothingEnabled = true;
  slide.ctx.drawImage(img, g.x, g.y, g.w, g.h);
  slide.ctx.imageSmoothingEnabled = false;
  const rect = clipRect(g);
  slide.gifs = slide.gifs.filter((x) => x.id !== g.id);
  selectedGif = null;
  const entries = [];
  if (rect) entries.push({ kind: 'paint' as const, rect, data: cropImageData(before, rect) });
  entries.push({ kind: 'gifs' as const, gifs: gifsBefore });
  pushUndo(slide, { kind: 'multi', entries });
  markChanged(slide, true);
  syncGifs();
}

export function getGifElement(id: string) {
  return gifEls.get(id);
}

// ---- drag and drop -------------------------------------------------------

function setupDrop(ws: HTMLElement) {
  const isExternal = (e: DragEvent) => {
    const types = Array.from(e.dataTransfer?.types ?? []);
    return types.includes('Files') || types.includes('text/uri-list');
  };
  ws.addEventListener('dragover', (e) => {
    if (!isExternal(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
    ws.classList.add('drop-target');
  });
  ws.addEventListener('dragleave', (e) => {
    if (e.target === ws) ws.classList.remove('drop-target');
  });
  ws.addEventListener('drop', async (e) => {
    ws.classList.remove('drop-target');
    if (!isExternal(e)) return;
    e.preventDefault();
    const at = toStage(e);
    const files = Array.from(e.dataTransfer!.files).filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      let offset = 0;
      for (const f of files) {
        await insertImageBlob(f, [at[0] + offset, at[1] + offset]).catch((err) => hooks.onHint(`Could not insert ${f.name}: ${err}`));
        offset += 40;
      }
      return;
    }
    const url = e.dataTransfer!.getData('text/uri-list').split('\n').find((l) => l && !l.startsWith('#'));
    if (!url) return;
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) throw new Error('not an image');
      await insertImageBlob(blob, at);
    } catch {
      hooks.onHint('That site blocked the download. Save the GIF to disk and drop the file instead.');
    }
  });
}

export function emitGifs() {
  emit('gifs', currentSlide());
}

export function deckHasSlides() {
  return deck.slides.length > 0;
}
