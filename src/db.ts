import { createSlide, deck } from './deck';
import type { GifObj, Slide } from './types';

const DB_NAME = 'paintdeck';
const DB_VERSION = 1;
const SAVE_DEBOUNCE_MS = 1000;

/** Latest PNG of each slide's paint layer, so file save doesn't need to re-encode clean slides. */
export const paintCache = new Map<string, Blob>();
const savedBlobIds = new Set<string>();

let dbPromise: Promise<IDBDatabase> | null = null;
let timer: number | undefined;
let saving: Promise<void> | null = null;
let again = false;
let statusListener: (s: 'saving' | 'saved' | 'error', detail?: string) => void = () => {};

export function onSaveStatus(fn: typeof statusListener) {
  statusListener = fn;
}

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of ['meta', 'slides', 'blobs']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function reqP<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png'),
  );
}

export async function slidePng(slide: Slide): Promise<Blob> {
  const cached = paintCache.get(slide.id);
  if (cached && !slide.paintDirty) return cached;
  const blob = await canvasToPng(slide.canvas);
  paintCache.set(slide.id, blob);
  return blob;
}

interface SlideRecord {
  id: string;
  paint: Blob;
  gifs: GifObj[];
}

export function scheduleSave() {
  clearTimeout(timer);
  timer = window.setTimeout(() => void saveNow(), SAVE_DEBOUNCE_MS);
}

export async function saveNow(): Promise<void> {
  clearTimeout(timer);
  if (saving) {
    again = true;
    return saving;
  }
  saving = (async () => {
    try {
      statusListener('saving');
      await writeDeck();
      statusListener('saved');
    } catch (err) {
      console.error('Autosave failed', err);
      statusListener('error', String(err));
    } finally {
      saving = null;
      if (again) {
        again = false;
        void saveNow();
      }
    }
  })();
  return saving;
}

async function writeDeck() {
  const records: SlideRecord[] = [];
  for (const slide of deck.slides) {
    if (!slide.dirty) continue;
    const paintWasDirty = slide.paintDirty;
    slide.dirty = false;
    let paint: Blob;
    if (paintWasDirty || !paintCache.has(slide.id)) {
      slide.paintDirty = false;
      paint = await canvasToPng(slide.canvas);
      paintCache.set(slide.id, paint);
    } else paint = paintCache.get(slide.id)!;
    records.push({ id: slide.id, paint, gifs: slide.gifs.map((g) => ({ ...g })) });
  }
  const referenced = new Set(deck.slides.flatMap((s) => s.gifs.map((g) => g.blobId)));
  const db = await openDb();
  const tx = db.transaction(['meta', 'slides', 'blobs'], 'readwrite');
  const slides = tx.objectStore('slides');
  const blobs = tx.objectStore('blobs');
  for (const r of records) slides.put(r, r.id);
  for (const id of referenced) {
    if (!savedBlobIds.has(id) && deck.blobs.has(id)) {
      blobs.put(deck.blobs.get(id)!, id);
      savedBlobIds.add(id);
    }
  }
  const order = deck.slides.map((s) => s.id);
  tx.objectStore('meta').put({ version: 1, order, current: deck.current }, 'deck');
  const keep = new Set(order);
  const slideKeys = (await reqP(slides.getAllKeys())) as string[];
  for (const k of slideKeys) if (!keep.has(k)) slides.delete(k);
  const blobKeys = (await reqP(blobs.getAllKeys())) as string[];
  for (const k of blobKeys) {
    if (!referenced.has(k)) {
      blobs.delete(k);
      savedBlobIds.delete(k);
    }
  }
  await txDone(tx);
}

export async function loadDeck(): Promise<{ slides: Slide[]; blobs: Map<string, Blob>; current: number } | null> {
  const db = await openDb();
  const tx = db.transaction(['meta', 'slides', 'blobs'], 'readonly');
  const meta = (await reqP(tx.objectStore('meta').get('deck'))) as { order: string[]; current: number } | undefined;
  if (!meta || !meta.order?.length) return null;
  const blobKeys = (await reqP(tx.objectStore('blobs').getAllKeys())) as string[];
  const blobVals = (await reqP(tx.objectStore('blobs').getAll())) as Blob[];
  const recs = (await reqP(tx.objectStore('slides').getAll())) as SlideRecord[];
  const byId = new Map(recs.map((r) => [r.id, r]));
  const blobs = new Map<string, Blob>();
  blobKeys.forEach((k, i) => {
    blobs.set(k, blobVals[i]);
    savedBlobIds.add(k);
  });
  const slides: Slide[] = [];
  for (const id of meta.order) {
    const rec = byId.get(id);
    if (!rec) continue;
    const slide = createSlide(id);
    try {
      const bmp = await createImageBitmap(rec.paint);
      slide.ctx.drawImage(bmp, 0, 0);
      bmp.close();
    } catch (err) {
      console.error('Could not restore paint for slide', id, err);
    }
    slide.gifs = (rec.gifs || []).filter((g) => blobs.has(g.blobId));
    slide.dirty = false;
    slide.paintDirty = false;
    paintCache.set(id, rec.paint);
    slides.push(slide);
  }
  if (!slides.length) return null;
  return { slides, blobs, current: meta.current || 0 };
}

/** After replacing the deck wholesale, every slide and blob must be rewritten. */
export function markAllUnsaved() {
  savedBlobIds.clear();
  paintCache.clear();
  for (const s of deck.slides) {
    s.dirty = true;
    s.paintDirty = true;
  }
}
