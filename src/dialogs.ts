// XP-styled in-page dialogs. Native alert/confirm block automation and look out of place.

let open: { close: (v: boolean) => void } | null = null;

export function dialogOpen() {
  return !!open;
}

interface DialogOpts {
  title: string;
  body: string | HTMLElement;
  ok?: string;
  cancel?: string | null;
  danger?: boolean;
  wide?: boolean;
}

export function showDialog(opts: DialogOpts): Promise<boolean> {
  open?.close(false);
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    const win = document.createElement('div');
    win.className = 'window dialog' + (opts.wide ? ' wide' : '');
    win.setAttribute('role', 'dialog');
    win.innerHTML = `<div class="title-bar"><div class="title-bar-text"></div><div class="title-bar-controls"><button class="tb-close" aria-label="Close"></button></div></div><div class="window-body"><div class="dialog-content"></div><div class="dialog-buttons"></div></div>`;
    win.querySelector('.title-bar-text')!.textContent = opts.title;
    const content = win.querySelector('.dialog-content')!;
    if (typeof opts.body === 'string') {
      const p = document.createElement('p');
      p.textContent = opts.body;
      content.append(p);
    } else content.append(opts.body);
    const buttons = win.querySelector('.dialog-buttons')!;
    const okBtn = document.createElement('button');
    okBtn.className = 'btn';
    okBtn.textContent = opts.ok ?? 'OK';
    buttons.append(okBtn);
    let cancelBtn: HTMLButtonElement | null = null;
    if (opts.cancel !== null) {
      cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn';
      cancelBtn.textContent = opts.cancel ?? 'Cancel';
      buttons.append(cancelBtn);
    }
    backdrop.append(win);
    document.body.append(backdrop);

    const close = (v: boolean) => {
      if (open?.close !== close) return;
      open = null;
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }
    };
    open = { close };
    document.addEventListener('keydown', onKey, true);
    okBtn.onclick = () => close(true);
    if (cancelBtn) cancelBtn.onclick = () => close(false);
    (win.querySelector('.tb-close') as HTMLButtonElement).onclick = () => close(false);
    (opts.danger && cancelBtn ? cancelBtn : okBtn).focus();
  });
}

export function confirmDialog(title: string, body: string, ok = 'OK', danger = false): Promise<boolean> {
  return showDialog({ title, body, ok, cancel: 'Cancel', danger });
}

export function alertDialog(title: string, body: string | HTMLElement, wide = false): Promise<boolean> {
  return showDialog({ title, body, cancel: null, wide });
}

let menuEl: HTMLElement | null = null;

export interface CtxItem {
  label: string;
  action: () => void;
  disabled?: boolean;
}

export function closeContextMenu() {
  menuEl?.remove();
  menuEl = null;
}

export function showContextMenu(x: number, y: number, items: (CtxItem | 'sep')[]) {
  closeContextMenu();
  const m = document.createElement('div');
  m.className = 'menu-popup context';
  for (const it of items) {
    if (it === 'sep') {
      m.append(Object.assign(document.createElement('div'), { className: 'menu-sep' }));
      continue;
    }
    const row = document.createElement('div');
    row.className = 'menu-item' + (it.disabled ? ' disabled' : '');
    row.innerHTML = '<span class="mi-label"></span>';
    row.querySelector('.mi-label')!.textContent = it.label;
    row.onpointerup = (e) => {
      e.stopPropagation();
      if (it.disabled) return;
      closeContextMenu();
      it.action();
    };
    m.append(row);
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.min(x, window.innerWidth - r.width - 4)}px`;
  m.style.top = `${Math.min(y, window.innerHeight - r.height - 4)}px`;
  menuEl = m;
  setTimeout(() => {
    const off = (e: Event) => {
      if (menuEl && !menuEl.contains(e.target as Node)) {
        closeContextMenu();
        document.removeEventListener('pointerdown', off, true);
      }
    };
    document.addEventListener('pointerdown', off, true);
  });
}
