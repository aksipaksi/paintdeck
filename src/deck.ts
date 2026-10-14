import { cropImageData } from './raster';
import { STAGE_H, STAGE_W, type GifObj, type Rect, type Slide, type UndoEntry } from './types';

const MAX_UNDO = 40;
const UNDO_BYTE_BUDGET = 900 * 1024 * 1024;

type EventName = 'slides' | 'current' | 'content' | 'gifs';
const listeners = new Map<EventName, Set<(slide?: Slide) => void>>();

export function on(name: EventName, fn: (slide?: Slide) => void) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name)!.add(fn);
}

export function emit(name: EventName, slide?: Slide) {
  listeners.get(name)?.forEach((fn) => fn(slide));
}

export const deck = {
  slides: [] as Slide[],
  current: 0,
  blobs: new Map<string, Blob>(),
  urls: new Map<string, string>(),
  /** Changes not yet written to a .paintdeck file (autosave is separate). */
  fileDirty: false,
};

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function newCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = STAGE_W;
  canvas.height = STAGE_H;
  canvas.className = 'paint-layer';
  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false })!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  return { canvas, ctx };
}

export function createSlide(id = uid()): Slide {
  const { canvas, ctx } = newCanvas();
  return { id, canvas, ctx, gifs: [], undo: [], redo: [], paintDirty: true, dirty: true };
}

export function currentSlide(): Slide {
  return deck.slides[deck.current];
}

export function addBlob(blob: Blob, id = uid()): string {
  deck.blobs.set(id, blob);
  return id;
}

export function blobUrl(blobId: string): string {
  let url = deck.urls.get(blobId);
  if (!url) {
    const blob = deck.blobs.get(blobId);
    if (!blob) return '';
    url = URL.createObjectURL(blob);
    deck.urls.set(blobId, url);
  }
  return url;
}

export function resetDeck(slides: Slide[], blobs: Map<string, Blob>, current = 0) {
  deck.urls.forEach((u) => URL.revokeObjectURL(u));
  deck.urls.clear();
  deck.blobs = blobs;
  deck.slides = slides;
  deck.current = Math.max(0, Math.min(current, slides.length - 1));
  emit('slides');
  emit('current');
}

function entryBytes(e: UndoEntry): number {
  if (e.kind === 'multi') return e.entries.reduce((n, x) => n + entryBytes(x), 0);
  return e.kind === 'paint' ? e.data.data.byteLength : 200;
}

function enforceBudget() {
  let total = 0;
  for (const s of deck.slides) for (const e of [...s.undo, ...s.redo]) total += entryBytes(e);
  while (total > UNDO_BYTE_BUDGET) {
    const victim = deck.slides.reduce((a, b) => (b.undo.length > a.undo.length ? b : a));
    const dropped = victim.undo.shift();
    if (!dropped) break;
    total -= entryBytes(dropped);
  }
}

export function pushUndo(slide: Slide, entry: UndoEntry) {
  slide.undo.push(entry);
  if (slide.undo.length > MAX_UNDO) slide.undo.shift();
  slide.redo = [];
  enforceBudget();
}

/** Records a paint change whose "before" pixels were cut from `before` (a full-stage snapshot). */
export function pushPaintUndo(slide: Slide, rect: Rect | null, before: ImageData) {
  if (!rect) return;
  pushUndo(slide, { kind: 'paint', rect, data: cropImageData(before, rect) });
  markChanged(slide, true);
}

export function cloneGifs(gifs: GifObj[]): GifObj[] {
  return gifs.map((g) => ({ ...g }));
}

/** Call before mutating a slide's GIF list so the change can be undone. */
export function pushGifUndo(slide: Slide) {
  pushUndo(slide, { kind: 'gifs', gifs: cloneGifs(slide.gifs) });
}

function applyEntry(slide: Slide, entry: UndoEntry): UndoEntry {
  if (entry.kind === 'multi') {
    const inverses = [...entry.entries].reverse().map((e) => applyEntry(slide, e));
    return { kind: 'multi', entries: inverses.reverse() };
  }
  if (entry.kind === 'paint') {
    const { x, y, w, h } = entry.rect;
    const inverse: UndoEntry = { kind: 'paint', rect: entry.rect, data: slide.ctx.getImageData(x, y, w, h) };
    slide.ctx.putImageData(entry.data, x, y);
    markChanged(slide, true);
    return inverse;
  }
  const inverse: UndoEntry = { kind: 'gifs', gifs: cloneGifs(slide.gifs) };
  slide.gifs = cloneGifs(entry.gifs);
  markChanged(slide, false);
  emit('gifs', slide);
  return inverse;
}

export function undo(slide: Slide): boolean {
  const e = slide.undo.pop();
  if (!e) return false;
  slide.redo.push(applyEntry(slide, e));
  return true;
}

export function redo(slide: Slide): boolean {
  const e = slide.redo.pop();
  if (!e) return false;
  slide.undo.push(applyEntry(slide, e));
  return true;
}

export function markChanged(slide: Slide, paint: boolean) {
  slide.dirty = true;
  if (paint) slide.paintDirty = true;
  deck.fileDirty = true;
  emit('content', slide);
}

export function duplicateSlide(index: number): Slide {
  const src = deck.slides[index];
  const copy = createSlide();
  copy.ctx.drawImage(src.canvas, 0, 0);
  copy.gifs = src.gifs.map((g) => ({ ...g, id: uid() }));
  deck.slides.splice(index + 1, 0, copy);
  deck.fileDirty = true;
  return copy;
}

export function nextGifZ(slide: Slide): number {
  return slide.gifs.reduce((m, g) => Math.max(m, g.z), 0) + 1;
}
