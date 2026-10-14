import { deck, emit } from './deck';
import { STAGE_H, STAGE_W } from './types';

const CURSOR_HIDE_MS = 2000;
const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter']);
const PREV_KEYS = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace']);

interface Session {
  root: HTMLElement;
  wrap: HTMLElement;
  stage: HTMLElement;
  paint: HTMLCanvasElement;
  gifLayer: HTMLElement;
  annot: HTMLCanvasElement;
  black: HTMLElement;
  index: number;
  urls: string[];
  token: number;
  wentFullscreen: boolean;
  cursorTimer?: number;
  annotating: boolean;
  dDownAt: number;
  drawing: [number, number] | null;
  digits: string;
  cleanup: (() => void)[];
}

let s: Session | null = null;
let onExit: () => void = () => {};

export function isPresenting() {
  return !!s;
}

export function setPresenterExitHook(fn: () => void) {
  onExit = fn;
}

function fit() {
  if (!s) return;
  const scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
  s.wrap.style.width = `${STAGE_W * scale}px`;
  s.wrap.style.height = `${STAGE_H * scale}px`;
  s.stage.style.transform = `scale(${scale})`;
}

function decodeWithTimeout(img: HTMLImageElement, ms: number): Promise<void> {
  return Promise.race([img.decode().catch(() => {}), new Promise<void>((r) => setTimeout(r, ms))]);
}

async function show(index: number) {
  if (!s) return;
  const session = s;
  index = Math.max(0, Math.min(deck.slides.length - 1, index));
  const token = ++session.token;
  const slide = deck.slides[index];
  // A fresh object URL per show restarts every GIF from frame 1 (G6); same-URL images share one animation clock.
  const urls: string[] = [];
  const imgs = [...slide.gifs]
    .sort((a, b) => a.z - b.z)
    .map((g) => {
      const blob = deck.blobs.get(g.blobId);
      const img = new Image();
      if (blob) {
        const url = URL.createObjectURL(blob);
        urls.push(url);
        img.src = url;
      }
      img.className = 'gif-obj';
      Object.assign(img.style, { left: `${g.x}px`, top: `${g.y}px`, width: `${g.w}px`, height: `${g.h}px`, zIndex: String(g.z) });
      return img;
    });
  await Promise.all(imgs.map((i) => decodeWithTimeout(i, 400)));
  if (!s || token !== session.token) {
    urls.forEach((u) => URL.revokeObjectURL(u));
    return;
  }
  session.paint.getContext('2d')!.drawImage(slide.canvas, 0, 0);
  session.gifLayer.replaceChildren(...imgs);
  session.urls.forEach((u) => URL.revokeObjectURL(u));
  session.urls = urls;
  session.index = index;
  session.annot.getContext('2d')!.clearRect(0, 0, STAGE_W, STAGE_H);
  session.black.style.display = 'none';
  preloadAround(index);
}

/** Warm the decoder for neighbouring slides' GIFs so advancing never waits on a big file. */
function preloadAround(index: number) {
  for (const i of [index + 1, index - 1]) {
    const slide = deck.slides[i];
    if (!slide) continue;
    for (const g of slide.gifs) {
      const blob = deck.blobs.get(g.blobId);
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.src = url;
      img.decode().catch(() => {}).finally(() => URL.revokeObjectURL(url));
    }
  }
}

function go(delta: number) {
  if (!s) return;
  const target = s.index + delta;
  if (target < 0 || target >= deck.slides.length) {
    if (s.black.style.display !== 'none') s.black.style.display = 'none';
    return;
  }
  void show(target);
}

function pokeCursor() {
  if (!s) return;
  s.root.classList.remove('hide-cursor');
  clearTimeout(s.cursorTimer);
  s.cursorTimer = window.setTimeout(() => s?.root.classList.add('hide-cursor'), CURSOR_HIDE_MS);
}

function setAnnotating(on: boolean) {
  if (!s) return;
  s.annotating = on;
  s.root.classList.toggle('annotating', on);
}

function stagePoint(e: PointerEvent): [number, number] {
  const r = s!.wrap.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * STAGE_W, ((e.clientY - r.top) / r.height) * STAGE_H];
}

export async function startPresentation(fromIndex: number) {
  if (s || !deck.slides.length) return;
  const root = document.createElement('div');
  root.className = 'presenter';
  root.tabIndex = -1;
  const wrap = document.createElement('div');
  wrap.className = 'pres-wrap';
  const stage = document.createElement('div');
  stage.className = 'pres-stage';
  const paint = document.createElement('canvas');
  paint.width = STAGE_W;
  paint.height = STAGE_H;
  paint.className = 'paint-layer';
  const gifLayer = document.createElement('div');
  gifLayer.className = 'gif-layer';
  const annot = document.createElement('canvas');
  annot.width = STAGE_W;
  annot.height = STAGE_H;
  annot.className = 'annot-layer';
  const black = document.createElement('div');
  black.className = 'pres-black';
  stage.append(paint, gifLayer, annot);
  wrap.append(stage);
  root.append(wrap, black);
  document.body.append(root);

  s = {
    root,
    wrap,
    stage,
    paint,
    gifLayer,
    annot,
    black,
    index: fromIndex,
    urls: [],
    token: 0,
    wentFullscreen: false,
    annotating: false,
    dDownAt: 0,
    drawing: null,
    digits: '',
    cleanup: [],
  };
  const session = s;

  try {
    await root.requestFullscreen({ navigationUI: 'hide' });
    session.wentFullscreen = true;
  } catch {
    // Fullscreen refused (no user gesture or not allowed): stay as a maximised in-page overlay.
    root.classList.add('in-page');
  }
  root.focus();
  fit();
  await show(fromIndex);
  pokeCursor();

  const listen = <K extends keyof WindowEventMap>(target: Window | Document | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
    target.addEventListener(type, fn as EventListener, opts);
    session.cleanup.push(() => target.removeEventListener(type, fn as EventListener, opts));
  };

  listen(window, 'resize', fit);
  listen(document, 'fullscreenchange' as keyof WindowEventMap, () => {
    if (!document.fullscreenElement && session.wentFullscreen) stopPresentation();
  });
  listen(window, 'keydown', (e: KeyboardEvent) => onKeyDown(e), { capture: true });
  listen(window, 'keyup', (e: KeyboardEvent) => onKeyUp(e), { capture: true });
  listen(root, 'mousemove', pokeCursor);
  listen(root, 'contextmenu', (e: MouseEvent) => {
    e.preventDefault();
    if (!session.annotating) go(-1);
  });
  listen(root, 'pointerdown', (e: PointerEvent) => {
    pokeCursor();
    retryFullscreen();
    if (session.annotating && e.button === 0) {
      session.drawing = stagePoint(e);
      root.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 0) go(1);
  });
  listen(root, 'pointermove', (e: PointerEvent) => {
    if (!session.drawing) return;
    const p = stagePoint(e);
    const ctx = session.annot.getContext('2d')!;
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(session.drawing[0], session.drawing[1]);
    ctx.lineTo(p[0], p[1]);
    ctx.stroke();
    session.drawing = p;
  });
  listen(root, 'pointerup', () => (session.drawing = null));
}

/** If the first fullscreen request was refused, any key or click in the presenter is a fresh gesture to retry with. */
function retryFullscreen() {
  if (!s || s.wentFullscreen || document.fullscreenElement) return;
  const session = s;
  session.root
    .requestFullscreen({ navigationUI: 'hide' })
    .then(() => {
      session.wentFullscreen = true;
      session.root.classList.remove('in-page');
    })
    .catch(() => {});
}

function onKeyDown(e: KeyboardEvent) {
  if (!s) return;
  e.stopPropagation();
  if (e.key !== 'Escape') retryFullscreen();
  const k = e.key;
  if (k === 'Escape') {
    e.preventDefault();
    stopPresentation();
    return;
  }
  if (k === 'F5') {
    e.preventDefault();
    return;
  }
  if (/^[0-9]$/.test(k)) {
    s.digits += k;
    return;
  }
  if (k === 'Enter' && s.digits) {
    e.preventDefault();
    const n = parseInt(s.digits, 10);
    s.digits = '';
    if (n >= 1) void show(n - 1);
    return;
  }
  s.digits = '';
  if (NEXT_KEYS.has(k)) {
    e.preventDefault();
    go(1);
  } else if (PREV_KEYS.has(k)) {
    e.preventDefault();
    go(-1);
  } else if (k === 'Home') {
    e.preventDefault();
    void show(0);
  } else if (k === 'End') {
    e.preventDefault();
    void show(deck.slides.length - 1);
  } else if (k === 'b' || k === 'B' || k === '.') {
    e.preventDefault();
    s.black.style.display = s.black.style.display === 'block' ? 'none' : 'block';
  } else if ((k === 'd' || k === 'D') && !e.repeat) {
    e.preventDefault();
    s.dDownAt = performance.now();
    if (!s.annotating) setAnnotating(true);
    else s.dDownAt = -1;
  } else if (k === 'c' || k === 'C') {
    s.annot.getContext('2d')!.clearRect(0, 0, STAGE_W, STAGE_H);
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (!s) return;
  e.stopPropagation();
  if (e.key !== 'd' && e.key !== 'D') return;
  // Tap D toggles drawing; hold D draws only while held.
  if (s.dDownAt === -1) setAnnotating(false);
  else if (performance.now() - s.dDownAt > 350) setAnnotating(false);
}

export function stopPresentation() {
  if (!s) return;
  const session = s;
  s = null;
  session.cleanup.forEach((fn) => fn());
  clearTimeout(session.cursorTimer);
  session.urls.forEach((u) => URL.revokeObjectURL(u));
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  session.root.remove();
  deck.current = session.index;
  emit('current');
  onExit();
}
