import { saveNow } from './db';
import { createSlide, currentSlide, deck, duplicateSlide, emit, redo, resetDeck, undo } from './deck';
import { alertDialog, confirmDialog } from './dialogs';
import {
  clearImage,
  commitPending,
  copySelection,
  cutSelection,
  hasInternalClipboard,
  insertImageBlob,
  pasteInternal,
} from './editor';
import { exportPngs, openDeckFile, saveDeckFile } from './fileio';
import { startPresentation } from './presenter';

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl+';

let hint: (msg: string) => void = () => {};
export function setHintHandler(fn: (msg: string) => void) {
  hint = fn;
}
export function showHint(msg: string) {
  hint(msg);
}

export function goToSlide(i: number) {
  if (i < 0 || i >= deck.slides.length || i === deck.current) return;
  commitPending();
  deck.current = i;
  emit('current');
}

export function addSlide() {
  commitPending();
  const s = createSlide();
  deck.slides.splice(deck.current + 1, 0, s);
  deck.current += 1;
  deck.fileDirty = true;
  emit('slides');
  emit('current');
}

export function duplicateCurrent() {
  commitPending();
  duplicateSlide(deck.current);
  deck.current += 1;
  emit('slides');
  emit('current');
}

export async function deleteCurrent() {
  commitPending();
  const n = deck.current + 1;
  const ok = await confirmDialog('Delete slide', `Delete slide ${n}? This can't be undone.`, 'Delete', true);
  if (!ok) return;
  deck.slides.splice(deck.current, 1);
  if (!deck.slides.length) deck.slides.push(createSlide());
  deck.current = Math.min(deck.current, deck.slides.length - 1);
  deck.fileDirty = true;
  emit('slides');
  emit('current');
}

export function moveSlide(from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= deck.slides.length || to >= deck.slides.length) return;
  commitPending();
  const currentId = currentSlide().id;
  const [s] = deck.slides.splice(from, 1);
  deck.slides.splice(to, 0, s);
  deck.current = deck.slides.findIndex((x) => x.id === currentId);
  deck.fileDirty = true;
  emit('slides');
  emit('current');
}

export function doUndo() {
  commitPending();
  if (!undo(currentSlide())) showHint('Nothing to undo on this slide');
}

export function doRedo() {
  commitPending();
  if (!redo(currentSlide())) showHint('Nothing to redo on this slide');
}

export function doCopy() {
  if (!copySelection()) showHint('Select an area first (Select tool)');
}

export function doCut() {
  if (!cutSelection()) showHint('Select an area first (Select tool)');
}

/** Menu-triggered paste: the async clipboard API may be blocked, so fall back to the internal clipboard. */
export async function menuPaste() {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) {
        await insertImageBlob(await item.getType(type));
        return;
      }
    }
  } catch {
    /* permission denied or unsupported */
  }
  if (pasteInternal()) return;
  showHint(`Press ${MOD}V to paste from the clipboard`);
}

export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}

export async function pasteFrom() {
  const files = await pickFiles('image/*');
  for (const f of files) await insertImageBlob(f).catch((e) => showHint(`Could not insert ${f.name}: ${e}`));
}

export async function insertGif() {
  const files = await pickFiles('image/gif');
  for (const f of files) await insertImageBlob(f).catch((e) => showHint(`Could not insert ${f.name}: ${e}`));
}

export async function newDeck() {
  commitPending();
  if (deck.fileDirty) {
    const ok = await confirmDialog(
      'New deck',
      'Start a new, empty deck? Changes not saved to a .paintdeck file will be lost.',
      'Start new',
      true,
    );
    if (!ok) return;
  }
  resetDeck([createSlide()], new Map(), 0);
  deck.fileDirty = false;
  void saveNow();
}

export async function saveFile() {
  commitPending();
  try {
    await saveDeckFile();
    showHint('Saved .paintdeck file to your Downloads');
  } catch (e) {
    await alertDialog('Save failed', String(e));
  }
}

export async function openFile() {
  commitPending();
  const [file] = await pickFiles('.paintdeck,.zip,application/zip', false);
  if (!file) return;
  if (deck.fileDirty) {
    const ok = await confirmDialog(
      'Open deck',
      `Opening "${file.name}" replaces the current deck. Changes not saved to a .paintdeck file will be lost.`,
      'Open',
      true,
    );
    if (!ok) return;
  }
  try {
    await openDeckFile(file);
    showHint(`Opened ${file.name}`);
  } catch (e) {
    await alertDialog('Could not open file', String(e instanceof Error ? e.message : e));
  }
}

export async function exportAllPngs() {
  commitPending();
  showHint('Exporting PNGs…');
  try {
    await exportPngs();
    showHint('Exported slides as PNGs (zip) to your Downloads');
  } catch (e) {
    await alertDialog('Export failed', String(e));
  }
}

export function present(fromCurrent: boolean) {
  commitPending();
  void startPresentation(fromCurrent ? deck.current : 0);
}

export function doClearImage() {
  clearImage();
}

export { hasInternalClipboard };
