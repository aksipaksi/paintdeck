import { unzipSync, zipSync, type Zippable } from 'fflate';
import { blobUrl, createSlide, deck, resetDeck } from './deck';
import { markAllUnsaved, saveNow, slidePng, canvasToPng } from './db';
import { STAGE_H, STAGE_W, type DeckJson, type Slide } from './types';

async function bytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function download(data: Uint8Array | Blob, name: string, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export async function saveDeckFile(): Promise<void> {
  const files: Zippable = {};
  const json: DeckJson = { version: 1, slides: [] };
  const blobPaths = new Map<string, string>();
  for (const [i, slide] of deck.slides.entries()) {
    const paintPath = `slides/${String(i + 1).padStart(3, '0')}-${slide.id}.png`;
    files[paintPath] = [await bytes(await slidePng(slide)), { level: 0 }];
    const gifs = [];
    for (const g of slide.gifs) {
      let path = blobPaths.get(g.blobId);
      if (!path) {
        const blob = deck.blobs.get(g.blobId);
        if (!blob) continue;
        path = `gifs/${g.blobId}.gif`;
        files[path] = [await bytes(blob), { level: 0 }];
        blobPaths.set(g.blobId, path);
      }
      gifs.push({ id: g.id, blob: path, x: g.x, y: g.y, w: g.w, h: g.h, z: g.z });
    }
    json.slides.push({ id: slide.id, paint: paintPath, gifs });
  }
  files['deck.json'] = new TextEncoder().encode(JSON.stringify(json, null, 2));
  download(zipSync(files), `deck-${stamp()}.paintdeck`, 'application/zip');
  deck.fileDirty = false;
}

export async function openDeckFile(file: File): Promise<void> {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const raw = entries['deck.json'];
  if (!raw) throw new Error('Not a .paintdeck file (deck.json missing)');
  const json = JSON.parse(new TextDecoder().decode(raw)) as DeckJson;
  if (json.version !== 1 || !Array.isArray(json.slides)) throw new Error('Unsupported .paintdeck version');
  const blobs = new Map<string, Blob>();
  const pathToBlobId = new Map<string, string>();
  const slides: Slide[] = [];
  for (const js of json.slides) {
    const slide = createSlide(js.id);
    const png = entries[js.paint];
    if (png) {
      const bmp = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }));
      slide.ctx.drawImage(bmp, 0, 0);
      bmp.close();
    }
    for (const g of js.gifs) {
      let blobId = pathToBlobId.get(g.blob);
      if (!blobId) {
        const data = entries[g.blob];
        if (!data) continue;
        blobId = g.blob.replace(/^gifs\//, '').replace(/\.gif$/, '');
        blobs.set(blobId, new Blob([data as BlobPart], { type: 'image/gif' }));
        pathToBlobId.set(g.blob, blobId);
      }
      slide.gifs.push({ id: g.id, blobId, x: g.x, y: g.y, w: g.w, h: g.h, z: g.z });
    }
    slides.push(slide);
  }
  if (!slides.length) throw new Error('The file has no slides');
  resetDeck(slides, blobs, 0);
  markAllUnsaved();
  deck.fileDirty = false;
  await saveNow();
}

/** Flattens a slide (paint + GIFs at their current frame) into one canvas. */
export async function flattenSlide(slide: Slide): Promise<HTMLCanvasElement> {
  const c = document.createElement('canvas');
  c.width = STAGE_W;
  c.height = STAGE_H;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(slide.canvas, 0, 0);
  for (const g of [...slide.gifs].sort((a, b) => a.z - b.z)) {
    const img = new Image();
    img.src = blobUrl(g.blobId);
    try {
      await img.decode();
      ctx.drawImage(img, g.x, g.y, g.w, g.h);
    } catch (err) {
      console.warn('Could not draw GIF into export', err);
    }
  }
  return c;
}

export async function exportPngs(): Promise<void> {
  const files: Zippable = {};
  for (const [i, slide] of deck.slides.entries()) {
    const c = await flattenSlide(slide);
    files[`slide-${String(i + 1).padStart(2, '0')}.png`] = [await bytes(await canvasToPng(c)), { level: 0 }];
  }
  download(zipSync(files), `slides-${stamp()}.zip`, 'application/zip');
}
