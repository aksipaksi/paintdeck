import './style.css';
import * as cmd from './commands';
import { loadDeck, saveNow, scheduleSave } from './db';
import { createSlide, deck, on, resetDeck } from './deck';
import { alertDialog, closeContextMenu, dialogOpen } from './dialogs';
import { commitOrDeselect, deleteSelection, hasFloating, insertImageBlob, pasteInternal, selectAll } from './editor';
import { isPresenting, setPresenterExitHook } from './presenter';
import { closeMenus, menusOpen, mountUI } from './ui';

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.isContentEditable);
}

function onKeyDown(e: KeyboardEvent) {
  if (isPresenting() || dialogOpen()) return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key;

  // F5 would reload the page and look like the app crashed; always swallow it.
  if (k === 'F5') {
    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur?.();
    cmd.present(e.shiftKey);
    return;
  }
  if (mod && k.toLowerCase() === 's') {
    e.preventDefault();
    void cmd.saveFile();
    return;
  }
  if (isTyping(e.target)) return;

  if (menusOpen() && k === 'Escape') {
    closeMenus();
    return;
  }
  closeContextMenu();

  if (mod) {
    switch (k.toLowerCase()) {
      case 'z':
        e.preventDefault();
        if (e.shiftKey) cmd.doRedo();
        else cmd.doUndo();
        return;
      case 'y':
        e.preventDefault();
        cmd.doRedo();
        return;
      case 'c':
        e.preventDefault();
        cmd.doCopy();
        return;
      case 'x':
        e.preventDefault();
        cmd.doCut();
        return;
      case 'a':
        e.preventDefault();
        selectAll();
        return;
      case 'o':
        e.preventDefault();
        void cmd.openFile();
        return;
      case 'd':
        e.preventDefault();
        cmd.duplicateCurrent();
        return;
      case 'arrowup':
        e.preventDefault();
        cmd.goToSlide(deck.current - 1);
        return;
      case 'arrowdown':
        e.preventDefault();
        cmd.goToSlide(deck.current + 1);
        return;
    }
    return;
  }

  switch (k) {
    case 'PageUp':
      e.preventDefault();
      cmd.goToSlide(deck.current - 1);
      return;
    case 'PageDown':
      e.preventDefault();
      cmd.goToSlide(deck.current + 1);
      return;
    case 'Delete':
    case 'Backspace':
      if (deleteSelection()) e.preventDefault();
      return;
    case 'Enter':
      if (hasFloating()) {
        e.preventDefault();
        commitOrDeselect();
      }
      return;
    case 'Escape':
      commitOrDeselect();
      return;
  }
}

async function onPaste(e: ClipboardEvent) {
  if (isPresenting() || dialogOpen() || isTyping(e.target)) return;
  const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
  e.preventDefault();
  if (files.length) {
    const f = files[0];
    await insertImageBlob(f).catch((err) => cmd.showHint(`Could not paste image: ${err}`));
    if (f.type !== 'image/gif') {
      cmd.showHint('Pasted. Enter or click outside to stamp. Animated GIFs paste as stills: drag the .gif file in or use Edit → Insert Animated GIF… instead.');
    }
    return;
  }
  if (!pasteInternal()) cmd.showHint('Nothing to paste: the clipboard has no image');
}

async function boot() {
  const app = document.getElementById('app')!;
  let restored = null;
  try {
    restored = await loadDeck();
  } catch (err) {
    console.error('Restore failed', err);
  }
  if (restored) resetDeck(restored.slides, restored.blobs, restored.current);
  else resetDeck([createSlide()], new Map(), 0);
  deck.fileDirty = false;

  mountUI(app);

  on('content', scheduleSave);
  on('slides', scheduleSave);
  on('current', scheduleSave);
  on('gifs', scheduleSave);
  if (!restored) scheduleSave();

  window.addEventListener('keydown', onKeyDown);
  document.addEventListener('paste', (e) => void onPaste(e));
  // Last-chance flush; the debounce means at most ~1s of work is at risk anyway.
  window.addEventListener('pagehide', () => void saveNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void saveNow();
  });
  // Dropping a file anywhere outside the canvas must not navigate away from the app.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  setPresenterExitHook(() => {});

  if (restored) cmd.showHint(`Restored your deck (${deck.slides.length} slide${deck.slides.length === 1 ? '' : 's'})`);
  if (!('indexedDB' in window)) void alertDialog('No autosave', 'This browser has no IndexedDB, so autosave is off. Use File → Save often.');
}

void boot();
