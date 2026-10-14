import type { ToolId } from './types';

const svg = (body: string) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

export const TOOL_ICONS: Record<ToolId, string> = {
  select: svg('<rect x="1.5" y="2.5" width="13" height="11" fill="none" stroke="#000" stroke-dasharray="2 2"/>'),
  eraser: svg(
    '<path d="M2 11 L8 4 L14 9 L9 14 L4 14 Z" fill="#f5e7a0" stroke="#000"/><path d="M2 11 L7 14" stroke="#000"/><rect x="2" y="14" width="12" height="1" fill="#000"/>',
  ),
  fill: svg(
    '<path d="M3 7 L8 2 L13 7 L8 12 Z" fill="#fff" stroke="#000"/><path d="M3 7 L13 7 L8 12 Z" fill="#c0c0c0"/><path d="M13 7 Q15 10 13.5 13 Q12 10 13 7" fill="#0000ff"/>',
  ),
  eyedropper: svg(
    '<path d="M3 13 L9 7 L10 8 L4 14 Z" fill="#fff" stroke="#000"/><rect x="9" y="3" width="4" height="4" transform="rotate(45 11 5)" fill="#000"/><path d="M2 14 L3 13" stroke="#000"/>',
  ),
  pencil: svg(
    '<path d="M3 11 L11 3 L13 5 L5 13 Z" fill="#f2c94c" stroke="#000"/><path d="M3 11 L2 14 L5 13" fill="#f9e0b0" stroke="#000"/><path d="M10 4 L12 6" stroke="#000"/>',
  ),
  brush: svg(
    '<path d="M9 7 L14 2" stroke="#8b4513" stroke-width="2"/><path d="M8 6 L10 8" stroke="#888" stroke-width="2"/><path d="M8 8 Q4 8 3 13 Q7 13 8 9 Z" fill="#000"/>',
  ),
  airbrush: svg(
    '<rect x="6" y="5" width="6" height="10" fill="#c0c0c0" stroke="#000"/><rect x="8" y="2" width="2" height="3" fill="#000"/><rect x="2" y="2" width="1" height="1"/><rect x="4" y="1" width="1" height="1"/><rect x="3" y="4" width="1" height="1"/><rect x="1" y="5" width="1" height="1"/><rect x="5" y="3" width="1" height="1"/>',
  ),
  text: svg('<path d="M3 14 L7.5 2 L8.5 2 L13 14 M5 10 L11 10" fill="none" stroke="#000" stroke-width="2"/>'),
  line: svg('<path d="M2 14 L14 2" stroke="#000" stroke-width="1.5" shape-rendering="auto"/>'),
  rect: svg('<rect x="2.5" y="3.5" width="11" height="9" fill="none" stroke="#000"/>'),
  ellipse: svg('<ellipse cx="8" cy="8" rx="6" ry="4.5" fill="none" stroke="#000" shape-rendering="auto"/>'),
  roundrect: svg('<rect x="2.5" y="3.5" width="11" height="9" rx="3" fill="none" stroke="#000" shape-rendering="auto"/>'),
};

export const TOOL_NAMES: Record<ToolId, string> = {
  select: 'Select (also moves GIFs)',
  eraser: 'Eraser / Color Eraser',
  fill: 'Fill With Color',
  eyedropper: 'Pick Color',
  pencil: 'Pencil',
  brush: 'Brush',
  airbrush: 'Airbrush',
  text: 'Text',
  line: 'Line',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  roundrect: 'Rounded Rectangle',
};

export const APP_ICON = svg(
  '<rect x="1" y="2" width="14" height="11" fill="#fff" stroke="#000"/><rect x="3" y="4" width="4" height="3" fill="#ff0000"/><rect x="8" y="6" width="5" height="4" fill="#0000ff"/><rect x="4" y="9" width="3" height="2" fill="#ffd700"/><rect x="6" y="13" width="4" height="2" fill="#808080"/>',
);
