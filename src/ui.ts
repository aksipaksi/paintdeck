import * as cmd from './commands';
import { MOD } from './commands';
import { onSaveStatus } from './db';
import { blobUrl, currentSlide, deck, on } from './deck';
import { alertDialog, showContextMenu } from './dialogs';
import {
  applyTextStyle,
  deleteGif,
  deleteSelection,
  getSelectionInfo,
  mountEditor,
  moveGifZ,
  selectAll,
  selectedGifObj,
  setColor,
  setEditorHooks,
  setTool,
  settings,
  stampGif,
} from './editor';
import { APP_ICON, TOOL_ICONS, TOOL_NAMES } from './icons';
import { STAGE_H, STAGE_W, type FillMode, type Slide, type ToolId } from './types';

export const PALETTE = [
  '#000000', '#808080', '#800000', '#808000', '#008000', '#008080', '#000080', '#800080', '#808040', '#004040', '#0080ff', '#004080', '#8000ff', '#804000',
  '#ffffff', '#c0c0c0', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ffff80', '#00ff80', '#80ffff', '#8080ff', '#ff0080', '#ff8040',
];

const FONTS = ['Arial', 'Times New Roman', 'Comic Sans MS', 'Courier New', 'Impact', 'Tahoma', 'Verdana', 'Georgia'];
const FONT_SIZES = [16, 20, 24, 32, 40, 48, 64, 80, 96, 120, 160, 200, 260];
const TOOL_ORDER: ToolId[] = ['select', 'eraser', 'fill', 'eyedropper', 'pencil', 'brush', 'airbrush', 'text', 'line', 'rect', 'ellipse', 'roundrect'];

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  e.append(...children);
  return e;
}

// ---- menus ----------------------------------------------------------------

interface MI {
  label: string;
  key?: string;
  run: () => void;
  enabled?: () => boolean;
  title?: string;
}
type MenuDef = [string, (MI | 'sep')[]];

function menus(): MenuDef[] {
  const hasSel = () => {
    const s = getSelectionInfo();
    return !!(s.marquee || s.floating);
  };
  const hasGif = () => !!selectedGifObj();
  return [
    [
      'File',
      [
        { label: 'New', run: () => void cmd.newDeck() },
        { label: 'Open…', key: `${MOD}O`, run: () => void cmd.openFile() },
        { label: 'Save', key: `${MOD}S`, run: () => void cmd.saveFile() },
        'sep',
        { label: 'Export Slides as PNGs (zip)', run: () => void cmd.exportAllPngs() },
        'sep',
        { label: 'Present from Start', key: `F5 or ${MOD}⇧↩`, run: () => cmd.present(false) },
        { label: 'Present from Current Slide', key: `⇧F5 or ${MOD}↩`, run: () => cmd.present(true) },
      ],
    ],
    [
      'Edit',
      [
        { label: 'Undo', key: `${MOD}Z`, run: cmd.doUndo, enabled: () => currentSlide().undo.length > 0 },
        { label: 'Repeat', key: `${MOD}Y`, run: cmd.doRedo, enabled: () => currentSlide().redo.length > 0 },
        'sep',
        { label: 'Cut', key: `${MOD}X`, run: cmd.doCut, enabled: hasSel },
        { label: 'Copy', key: `${MOD}C`, run: cmd.doCopy, enabled: hasSel },
        { label: 'Paste', key: `${MOD}V`, run: () => void cmd.menuPaste() },
        { label: 'Clear Selection', key: 'Del', run: () => void deleteSelection(), enabled: () => hasSel() || hasGif() },
        { label: 'Select All', key: `${MOD}A`, run: selectAll },
        'sep',
        { label: 'Paste From…', run: () => void cmd.pasteFrom() },
        {
          label: 'Insert Animated GIF…',
          run: () => void cmd.insertGif(),
          title: 'Copy-paste of a GIF from a browser is usually a still image. To keep it animating, drag the .gif file in or use this.',
        },
      ],
    ],
    [
      'Image',
      [
        { label: 'Clear Image', run: cmd.doClearImage },
        'sep',
        { label: 'Bring GIF Forward', run: () => moveGifZ(1), enabled: hasGif },
        { label: 'Send GIF Backward', run: () => moveGifZ(-1), enabled: hasGif },
        { label: 'Stamp GIF Frame into Canvas', run: stampGif, enabled: hasGif },
        { label: 'Delete GIF', run: deleteGif, enabled: hasGif },
      ],
    ],
    [
      'View',
      [
        { label: 'Toggle Slide Sidebar', run: () => document.body.classList.toggle('no-sidebar') },
        { label: 'Toggle Status Bar', run: () => document.body.classList.toggle('no-status') },
      ],
    ],
    [
      'Slide',
      [
        { label: 'New Slide', run: cmd.addSlide },
        { label: 'Duplicate Slide', key: `${MOD}D`, run: cmd.duplicateCurrent },
        { label: 'Delete Slide…', run: () => void cmd.deleteCurrent() },
        'sep',
        { label: 'Move Slide Up', run: () => cmd.moveSlide(deck.current, deck.current - 1), enabled: () => deck.current > 0 },
        { label: 'Move Slide Down', run: () => cmd.moveSlide(deck.current, deck.current + 1), enabled: () => deck.current < deck.slides.length - 1 },
        'sep',
        { label: 'Previous Slide', key: `${MOD}↑`, run: () => cmd.goToSlide(deck.current - 1) },
        { label: 'Next Slide', key: `${MOD}↓`, run: () => cmd.goToSlide(deck.current + 1) },
        'sep',
        { label: 'Present from Start', key: 'F5', run: () => cmd.present(false) },
        { label: 'Present from Current Slide', key: 'Shift+F5', run: () => cmd.present(true) },
      ],
    ],
    [
      'Help',
      [
        { label: 'Keyboard Shortcuts', run: showShortcuts },
        { label: 'About Paintdeck', run: showAbout },
      ],
    ],
  ];
}

let openMenu: HTMLElement | null = null;
let hoverOpenedAt = 0;

function buildMenuBar(): HTMLElement {
  const bar = h('div', { class: 'menubar' });
  for (const [name, items] of menus()) {
    const top = h('div', { class: 'menu-top' }, name);
    const popup = h('div', { class: 'menu-popup' });
    const rows: [HTMLElement, MI][] = [];
    for (const it of items) {
      if (it === 'sep') {
        popup.append(h('div', { class: 'menu-sep' }));
        continue;
      }
      const row = h('div', { class: 'menu-item' }, h('span', { class: 'mi-label' }, it.label), h('span', { class: 'mi-key' }, it.key ?? ''));
      if (it.title) row.title = it.title;
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (row.classList.contains('disabled')) return;
        closeMenus();
        it.run();
      });
      rows.push([row, it]);
      popup.append(row);
    }
    top.append(popup);
    const openThis = () => {
      closeMenus();
      for (const [row, it] of rows) row.classList.toggle('disabled', it.enabled ? !it.enabled() : false);
      top.classList.add('open');
      openMenu = top;
    };
    top.addEventListener('pointerdown', (e) => {
      if (e.target !== top) return;
      e.preventDefault();
      // A hover just switched to this menu; the click that follows must not toggle it shut.
      if (openMenu === top && performance.now() - hoverOpenedAt > 400) closeMenus();
      else openThis();
    });
    top.addEventListener('pointerenter', () => {
      if (openMenu && openMenu !== top) {
        openThis();
        hoverOpenedAt = performance.now();
      }
    });
    bar.append(top);
  }
  const present = h('button', { class: 'btn present-btn', title: 'Present from current slide (F5 = from start)' }, '▶ Present');
  present.addEventListener('click', () => cmd.present(true));
  bar.append(h('div', { class: 'menubar-spacer' }), present);
  document.addEventListener('pointerdown', (e) => {
    if (openMenu && !openMenu.contains(e.target as Node)) closeMenus();
  });
  return bar;
}

export function closeMenus() {
  openMenu?.classList.remove('open');
  openMenu = null;
}

export function menusOpen() {
  return !!openMenu;
}

function showShortcuts() {
  const rows: [string, string][] = [
    ['Undo / Redo', `${MOD}Z / ${MOD}Y or ${MOD}⇧Z`],
    ['Cut / Copy / Paste', `${MOD}X / ${MOD}C / ${MOD}V`],
    ['Select all', `${MOD}A`],
    ['Delete selection or GIF', 'Delete / Backspace'],
    ['Stamp floating image', 'Enter or click outside'],
    ['Save .paintdeck / Open', `${MOD}S / ${MOD}O`],
    ['Duplicate slide', `${MOD}D`],
    ['Previous / next slide', `${MOD}↑ / ${MOD}↓, PageUp / PageDown`],
    ['Present from start / current', `F5 / Shift+F5, or ${MOD}⇧Enter / ${MOD}Enter`],
    ['Shape: square, circle, 45° line', 'hold Shift while dragging'],
    ['Draw with secondary colour', 'right mouse button'],
    ['Copy selection while dragging', `${isMacKey()} + drag`],
    ['— Presenting —', ''],
    ['Next', '→ ↓ Space PageDown Enter, click'],
    ['Previous', '← ↑ PageUp Backspace, right-click'],
    ['Jump to slide N', 'type N, then Enter'],
    ['Black screen', 'B'],
    ['Draw in red', 'hold D, or tap D to toggle (C clears)'],
    ['Exit', 'Esc'],
  ];
  const table = h('table', { class: 'shortcuts' });
  for (const [a, b] of rows) table.append(h('tr', {}, h('td', {}, a), h('td', {}, b)));
  void alertDialog('Keyboard Shortcuts', table, true);
}

function isMacKey() {
  return cmd.isMac ? '⌘ or ⌥' : 'Ctrl';
}

function showAbout() {
  void alertDialog(
    'About Paintdeck',
    'Paintdeck: MS Paint, but every slide is a 1920×1080 canvas. Works offline; your deck autosaves in this browser. Use File → Save for a .paintdeck backup.',
  );
}

// ---- toolbox and options ---------------------------------------------------

const toolButtons = new Map<ToolId, HTMLElement>();
let optionsBox: HTMLElement;
let fontBar: HTMLElement;

function buildToolbox(): HTMLElement {
  const box = h('div', { class: 'toolbox' });
  const grid = h('div', { class: 'tool-grid' });
  for (const t of TOOL_ORDER) {
    const b = h('button', { class: 'tool', title: TOOL_NAMES[t], 'data-tool': t });
    b.innerHTML = TOOL_ICONS[t];
    b.addEventListener('click', () => setTool(t));
    toolButtons.set(t, b);
    grid.append(b);
  }
  optionsBox = h('div', { class: 'options-box' });
  box.append(grid, optionsBox);
  return box;
}

function optionRow(items: { label: Node | string; active: boolean; title: string; pick: () => void }[], cls = '') {
  const wrap = h('div', { class: `opt-list ${cls}` });
  for (const it of items) {
    const b = h('button', { class: 'opt' + (it.active ? ' active' : ''), title: it.title }, it.label);
    b.addEventListener('click', () => {
      it.pick();
      renderOptions();
    });
    wrap.append(b);
  }
  return wrap;
}

function dot(size: number, square = false) {
  const px = Math.max(2, Math.min(18, Math.round(size / 2)));
  return h('span', { class: 'dot' + (square ? ' sq' : ''), style: `width:${px}px;height:${px}px` });
}

function bar(width: number) {
  return h('span', { class: 'bar', style: `height:${Math.max(1, Math.min(8, Math.round(width / 1.5)))}px` });
}

const BRUSH_SIZES = [4, 8, 14, 24];
const ERASER_SIZES = [8, 16, 28, 48];
const LINE_WIDTHS = [1, 3, 6, 10, 16];
const AIR_SIZES = [16, 32, 56];

function fillModeIcon(mode: FillMode) {
  const fill = mode === 'outline' ? 'none' : mode === 'fill' ? '#808080' : '#c0c0c0';
  const stroke = mode === 'fill' ? 'none' : '#000';
  const s = h('span', { class: 'fillmode' });
  s.innerHTML = `<svg width="30" height="14" viewBox="0 0 30 14"><rect x="2.5" y="2.5" width="25" height="9" fill="${fill}" stroke="${stroke}"/></svg>`;
  return s;
}

function renderOptions() {
  const t = settings.tool;
  optionsBox.replaceChildren();
  if (t === 'brush') {
    const items = (['round', 'square'] as const).flatMap((shape) =>
      BRUSH_SIZES.map((size) => ({
        label: dot(size, shape === 'square'),
        active: settings.brushShape === shape && settings.brushSize === size,
        title: `${shape} ${size}px`,
        pick: () => Object.assign(settings, { brushShape: shape, brushSize: size }),
      })),
    );
    optionsBox.append(optionRow(items, 'grid4'));
  } else if (t === 'eraser') {
    optionsBox.append(
      optionRow(ERASER_SIZES.map((s) => ({ label: dot(s, true), active: settings.eraserSize === s, title: `${s}px`, pick: () => (settings.eraserSize = s) }))),
    );
  } else if (t === 'airbrush') {
    optionsBox.append(
      optionRow(AIR_SIZES.map((s) => ({ label: `${s}`, active: settings.airSize === s, title: `${s}px spray`, pick: () => (settings.airSize = s) }))),
    );
  } else if (t === 'line' || t === 'rect' || t === 'ellipse' || t === 'roundrect') {
    if (t !== 'line') {
      const modes: [FillMode, string][] = [
        ['outline', 'Outline'],
        ['both', 'Outline with secondary fill'],
        ['fill', 'Fill, no outline'],
      ];
      optionsBox.append(
        optionRow(modes.map(([m, title]) => ({ label: fillModeIcon(m), active: settings.fillMode === m, title, pick: () => (settings.fillMode = m) }))),
      );
    }
    optionsBox.append(
      optionRow(LINE_WIDTHS.map((w) => ({ label: bar(w), active: settings.lineWidth === w, title: `${w}px line`, pick: () => (settings.lineWidth = w) }))),
    );
  } else if (t === 'text') {
    optionsBox.append(
      optionRow([
        { label: 'Clear', active: !settings.textOpaque, title: 'Transparent background', pick: () => ((settings.textOpaque = false), applyTextStyle()) },
        { label: 'Opaque', active: settings.textOpaque, title: 'Background in secondary colour', pick: () => ((settings.textOpaque = true), applyTextStyle()) },
      ]),
    );
  } else if (t === 'select') {
    optionsBox.append(h('div', { class: 'opt-note' }, 'Drag to select. Click a GIF to move it.'));
  }
  for (const [id, b] of toolButtons) b.classList.toggle('active', id === t);
  fontBar.style.display = t === 'text' ? 'flex' : 'none';
}

function buildFontBar(): HTMLElement {
  const fam = h('select', { title: 'Font' }) as HTMLSelectElement;
  for (const f of FONTS) fam.append(h('option', { value: f, style: `font-family:'${f}'` }, f));
  fam.value = settings.font;
  const size = h('select', { title: 'Size (stage pixels)' }) as HTMLSelectElement;
  for (const s of FONT_SIZES) size.append(h('option', { value: String(s) }, String(s)));
  size.value = String(settings.fontSize);
  const bold = h('button', { class: 'opt fb', title: 'Bold' }, h('b', {}, 'B'));
  const ital = h('button', { class: 'opt fb', title: 'Italic' }, h('i', {}, 'I'));
  const sync = () => {
    bold.classList.toggle('active', settings.bold);
    ital.classList.toggle('active', settings.italic);
    applyTextStyle();
  };
  // Keep focus in the text box so editing continues after picking a font.
  for (const b of [bold, ital]) b.addEventListener('pointerdown', (e) => e.preventDefault());
  fam.onchange = () => ((settings.font = fam.value), sync());
  size.onchange = () => ((settings.fontSize = Number(size.value)), sync());
  bold.onclick = () => ((settings.bold = !settings.bold), sync());
  ital.onclick = () => ((settings.italic = !settings.italic), sync());
  const barEl = h('div', { class: 'window font-bar' }, h('div', { class: 'title-bar small' }, h('div', { class: 'title-bar-text' }, 'Fonts')), h('div', { class: 'font-row' }, fam, size, bold, ital));
  return barEl;
}

// ---- palette ---------------------------------------------------------------

let primarySw: HTMLElement;
let secondarySw: HTMLElement;
const colorInput = Object.assign(document.createElement('input'), { type: 'color' });

function buildPalette(): HTMLElement {
  const wrap = h('div', { class: 'palette' });
  const current = h('div', { class: 'current-colors', title: 'Click to swap primary and secondary' });
  secondarySw = h('div', { class: 'cc secondary' });
  primarySw = h('div', { class: 'cc primary' });
  current.append(secondarySw, primarySw);
  current.addEventListener('click', () => {
    const p = settings.primary;
    setColor('primary', settings.secondary);
    setColor('secondary', p);
  });
  const grid = h('div', { class: 'swatches' });
  PALETTE.forEach((c, i) => {
    const sw = h('div', { class: 'swatch', title: 'Left: primary · Right: secondary · Double-click: edit colour' });
    sw.style.background = c;
    sw.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      setColor(e.button === 2 ? 'secondary' : 'primary', PALETTE[i]);
    });
    sw.addEventListener('contextmenu', (e) => e.preventDefault());
    sw.addEventListener('dblclick', () => {
      colorInput.value = PALETTE[i];
      colorInput.oninput = () => {
        PALETTE[i] = colorInput.value;
        sw.style.background = colorInput.value;
        setColor('primary', colorInput.value);
      };
      colorInput.click();
    });
    grid.append(sw);
  });
  colorInput.className = 'hidden-color';
  wrap.append(current, grid, colorInput);
  return wrap;
}

function renderColors() {
  primarySw.style.background = settings.primary;
  secondarySw.style.background = settings.secondary;
}

// ---- status bar --------------------------------------------------------------

let stHint: HTMLElement;
let stCoords: HTMLElement;
let stSize: HTMLElement;
let stSave: HTMLElement;
let stSlide: HTMLElement;
let hintTimer: number | undefined;
const DEFAULT_HINT = 'For Help, click Help Topics on the Help Menu.';

function buildStatusBar(): HTMLElement {
  stHint = h('div', { class: 'st hint' }, DEFAULT_HINT);
  stCoords = h('div', { class: 'st coords' });
  stSize = h('div', { class: 'st size' });
  stSave = h('div', { class: 'st save' }, 'Saved');
  stSlide = h('div', { class: 'st slide' });
  return h('div', { class: 'statusbar' }, stHint, stSave, stCoords, stSize, stSlide);
}

function setHint(msg: string) {
  stHint.textContent = msg;
  stHint.title = msg;
  clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => (stHint.textContent = DEFAULT_HINT), 7000);
}

function renderSlideCounter() {
  stSlide.textContent = `${deck.current + 1} / ${deck.slides.length}`;
}

// ---- sidebar ---------------------------------------------------------------

let list: HTMLElement;
const thumbs = new Map<string, { item: HTMLElement; canvas: HTMLCanvasElement; gifs: HTMLElement; slide: Slide }>();
const pendingThumbs = new Set<Slide>();
const THUMB_W = 176;
const THUMB_H = Math.round((THUMB_W * STAGE_H) / STAGE_W);

function buildSidebar(): HTMLElement {
  const btn = (label: string, title: string, fn: () => void) => {
    const b = h('button', { class: 'btn small', title }, label);
    b.addEventListener('click', fn);
    return b;
  };
  const tools = h(
    'div',
    { class: 'side-tools' },
    btn('New', 'New slide', cmd.addSlide),
    btn('Copy', 'Duplicate slide', cmd.duplicateCurrent),
    btn('Delete', 'Delete slide', () => void cmd.deleteCurrent()),
  );
  list = h('div', { class: 'slide-list' });
  return h('div', { class: 'sidebar' }, tools, list);
}

let dragFrom = -1;

function renderSlideList() {
  const ids = new Set(deck.slides.map((s) => s.id));
  for (const id of [...thumbs.keys()]) if (!ids.has(id)) thumbs.delete(id);
  list.replaceChildren();
  deck.slides.forEach((slide, i) => {
    let t = thumbs.get(slide.id);
    if (!t) {
      const canvas = h('canvas', { class: 'thumb-canvas' }) as HTMLCanvasElement;
      canvas.width = THUMB_W;
      canvas.height = THUMB_H;
      const gifs = h('div', { class: 'thumb-gifs' });
      const frame = h('div', { class: 'thumb-frame' }, canvas, gifs);
      const item = h('div', { class: 'slide-item', draggable: 'true' }, h('div', { class: 'slide-num' }), frame);
      t = { item, canvas, gifs, slide };
      thumbs.set(slide.id, t);
      drawThumb(slide);
      wireItem(item, slide.id);
    } else if (t.slide !== slide) {
      // Same id but a new Slide object (deck reopened from file): redraw from the new canvas.
      t.slide = slide;
      drawThumb(slide);
    }
    t.item.querySelector('.slide-num')!.textContent = String(i + 1);
    t.item.classList.toggle('active', i === deck.current);
    list.append(t.item);
  });
  renderSlideCounter();
}

function indexOfItem(item: HTMLElement) {
  return Array.from(list.children).indexOf(item);
}

function wireItem(item: HTMLElement, id: string) {
  const index = () => deck.slides.findIndex((s) => s.id === id);
  item.addEventListener('click', () => cmd.goToSlide(index()));
  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    cmd.goToSlide(index());
    showContextMenu(e.clientX, e.clientY, [
      { label: 'New Slide', action: cmd.addSlide },
      { label: 'Duplicate Slide', action: cmd.duplicateCurrent },
      { label: 'Delete Slide…', action: () => void cmd.deleteCurrent() },
      'sep',
      { label: 'Present from Here', action: () => cmd.present(true) },
    ]);
  });
  item.addEventListener('dragstart', (e) => {
    dragFrom = indexOfItem(item);
    e.dataTransfer!.setData('application/x-paintdeck-slide', String(dragFrom));
    e.dataTransfer!.effectAllowed = 'move';
    item.classList.add('dragging');
  });
  item.addEventListener('dragend', () => {
    item.classList.remove('dragging');
    list.querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    dragFrom = -1;
  });
  item.addEventListener('dragover', (e) => {
    if (dragFrom < 0) return;
    e.preventDefault();
    const r = item.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    list.querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    item.classList.add(after ? 'drop-after' : 'drop-before');
  });
  item.addEventListener('drop', (e) => {
    if (dragFrom < 0) return;
    e.preventDefault();
    const r = item.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    let to = indexOfItem(item) + (after ? 1 : 0);
    if (to > dragFrom) to -= 1;
    cmd.moveSlide(dragFrom, to);
  });
}

function drawThumb(slide: Slide) {
  const t = thumbs.get(slide.id);
  if (!t) return;
  const ctx = t.canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(slide.canvas, 0, 0, THUMB_W, THUMB_H);
  const s = THUMB_W / STAGE_W;
  t.gifs.replaceChildren(
    ...[...slide.gifs]
      .sort((a, b) => a.z - b.z)
      .map((g) => {
        const img = new Image();
        img.src = blobUrl(g.blobId);
        img.draggable = false;
        Object.assign(img.style, { left: `${g.x * s}px`, top: `${g.y * s}px`, width: `${g.w * s}px`, height: `${g.h * s}px` });
        return img;
      }),
  );
}

function scheduleThumb(slide: Slide) {
  if (pendingThumbs.has(slide)) return;
  pendingThumbs.add(slide);
  setTimeout(() => {
    pendingThumbs.delete(slide);
    drawThumb(slide);
  }, 150);
}

// ---- layout ------------------------------------------------------------------

export function mountUI(app: HTMLElement) {
  const titleIcon = h('span', { class: 'title-icon' });
  titleIcon.innerHTML = APP_ICON;
  const titleText = h('div', { class: 'title-bar-text' }, titleIcon, h('span', { class: 'title-name' }, 'untitled - Paintdeck'));
  const title = h(
    'div',
    { class: 'title-bar app-title' },
    titleText,
    h('div', { class: 'title-bar-controls' }, h('button', { class: 'tb-min', tabindex: '-1' }), h('button', { class: 'tb-max', tabindex: '-1' }), h('button', { class: 'tb-close', tabindex: '-1' })),
  );
  const workspace = h('div', { class: 'workspace' });
  fontBar = buildFontBar();
  const body = h('div', { class: 'main' }, buildSidebar(), buildToolbox(), h('div', { class: 'workspace-outer' }, workspace, fontBar));
  app.append(title, buildMenuBar(), body, buildPalette(), buildStatusBar());

  setEditorHooks({
    onCursor: (x, y) => (stCoords.textContent = x === null ? '' : `${x}, ${y}px`),
    onHint: setHint,
    onToolChange: renderOptions,
    onColorsChange: renderColors,
    onSelectionChange: () => {
      const s = getSelectionInfo();
      const r = s.floating ?? s.marquee ?? selectedGifObj();
      stSize.textContent = r ? `${Math.round(r.w)} × ${Math.round(r.h)}` : '';
    },
    onGifContextMenu: (x, y) =>
      showContextMenu(x, y, [
        { label: 'Bring Forward', action: () => moveGifZ(1) },
        { label: 'Send Backward', action: () => moveGifZ(-1) },
        'sep',
        { label: 'Stamp Current Frame into Canvas', action: stampGif },
        { label: 'Delete GIF', action: deleteGif },
      ]),
  });
  cmd.setHintHandler(setHint);
  mountEditor(workspace);
  renderOptions();
  renderColors();

  on('slides', renderSlideList);
  on('current', () => {
    for (const [i, s] of deck.slides.entries()) thumbs.get(s.id)?.item.classList.toggle('active', i === deck.current);
    thumbs.get(currentSlide().id)?.item.scrollIntoView({ block: 'nearest' });
    renderSlideCounter();
  });
  on('content', (s) => s && scheduleThumb(s));
  on('gifs', (s) => s && scheduleThumb(s));
  renderSlideList();

  const name = title.querySelector('.title-name')!;
  const renderTitle = () => (name.textContent = `${deck.fileDirty ? '*' : ''}deck - Paintdeck`);
  on('content', renderTitle);
  on('slides', renderTitle);
  setInterval(renderTitle, 1000);

  onSaveStatus((st, detail) => {
    stSave.textContent = st === 'saving' ? 'Saving…' : st === 'saved' ? 'Autosaved' : 'Autosave FAILED';
    stSave.classList.toggle('error', st === 'error');
    stSave.title = detail ?? 'Your deck is saved in this browser automatically';
  });
}
