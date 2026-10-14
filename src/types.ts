export const STAGE_W = 1920;
export const STAGE_H = 1080;

export type ToolId =
  | 'select'
  | 'eyedropper'
  | 'fill'
  | 'pencil'
  | 'brush'
  | 'airbrush'
  | 'eraser'
  | 'text'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'roundrect';

export type FillMode = 'outline' | 'both' | 'fill';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GifObj {
  id: string;
  blobId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export type UndoEntry =
  | { kind: 'paint'; rect: Rect; data: ImageData }
  | { kind: 'gifs'; gifs: GifObj[] }
  | { kind: 'multi'; entries: UndoEntry[] };

export interface Slide {
  id: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  gifs: GifObj[];
  undo: UndoEntry[];
  redo: UndoEntry[];
  /** Paint pixels changed since the last autosave. */
  paintDirty: boolean;
  /** Anything (paint or GIFs) changed since the last autosave. */
  dirty: boolean;
}

/** Serialised deck format (PRD §3). Paint is a PNG blob; GIFs reference blobs by id. */
export interface DeckJson {
  version: 1;
  slides: { id: string; paint: string; gifs: (Omit<GifObj, 'blobId'> & { blob: string })[] }[];
}
