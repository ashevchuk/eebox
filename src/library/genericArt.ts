import type { ArtShape } from './art';
import { MODULE_UNIT_MM, type ModuleDef } from './types';

/*
 * The faces of the bundled devices: what tells a breaker from a relay on the panel. Coordinates are in
 * mm from the top left corner of a face that is 90 mm tall; the band at the top is 14 mm in the colour of
 * the kind, the rating sits at 22 mm, the name runs up the middle from 70 mm to 28 mm, and the terminals
 * are at 7 mm and 84 mm.
 */
const INK = '#1f2937';
const STEEL = '#9ca3af';
const PALE = '#e5e7eb';
const WHITE = '#ffffff';
const LOWER_ROW_MM = 77;
const WINDOW_TOP_MM = 2.5;
const WINDOW_HEIGHT_MM = 9;
const EDGE_MM = 2;
const CORNER_MM = 5;

const stroked = { stroke: INK, strokeWidth: 0.3 };

/** Screw head with a slot over each unit of a terminal bar, under the terminals. */
const screws = (): ArtShape[] =>
  [7, 83].flatMap((y): ArtShape[] => [
    { kind: 'ellipse', cx: MODULE_UNIT_MM / 2, cy: y, rx: 3.6, ry: 3.6, fill: PALE, stroke: STEEL, strokeWidth: 0.4, anchor: 'tile', period: 1 },
    { kind: 'line', x1: MODULE_UNIT_MM / 2 - 2.4, y1: y - 1.2, x2: MODULE_UNIT_MM / 2 + 2.4, y2: y + 1.2, stroke: STEEL, strokeWidth: 0.5, anchor: 'tile', period: 1 },
  ]);

/** A window across the band, where a handle sits, a relay shows its state or a meter its reading. */
const bandWindow = (width: number, fill: string): ArtShape => ({
  kind: 'rect',
  x: EDGE_MM,
  y: WINDOW_TOP_MM,
  width: width - 2 * EDGE_MM,
  height: WINDOW_HEIGHT_MM,
  fill,
  ...stroked,
  anchor: 'stretch',
});

/** A dark slot across the band, where the handle of a breaker sits. */
const lever = (width: number): ArtShape[] => [
  { kind: 'rect', x: EDGE_MM, y: WINDOW_TOP_MM, width: width - 2 * EDGE_MM, height: WINDOW_HEIGHT_MM, fill: INK, anchor: 'stretch' },
];

/** A round test button, lower down at the right where the name does not run. */
const testButton = (width: number): ArtShape[] => [
  { kind: 'ellipse', cx: width - CORNER_MM - 1, cy: LOWER_ROW_MM - 2, rx: 3.4, ry: 3.4, fill: '#facc15', ...stroked, anchor: 'right' },
  { kind: 'text', x: width - CORNER_MM - 1, y: LOWER_ROW_MM - 2, text: 'T', size: 3.6, fill: INK, align: 'centre', bold: true, anchor: 'right' },
];

const led = (colour: string, x: number, anchor: 'left' | 'right'): ArtShape => ({ kind: 'ellipse', cx: x, cy: 7, rx: 2, ry: 2, fill: colour, ...stroked, anchor });

/** A knob with its slot in the lower part of the face. */
const knob = (cx: number, anchor: 'left' | 'centre' | 'right'): ArtShape[] => [
  { kind: 'ellipse', cx, cy: LOWER_ROW_MM, rx: 3.6, ry: 3.6, fill: PALE, stroke: INK, strokeWidth: 0.4, anchor },
  { kind: 'line', x1: cx, y1: LOWER_ROW_MM - 3, x2: cx, y2: LOWER_ROW_MM, stroke: INK, strokeWidth: 0.7, anchor },
];

/** The two push buttons of a time switch, side by side in the lower part. */
const pushButtons = (cx: number): ArtShape[] =>
  [-4.5, 4.5].map((dx): ArtShape => ({ kind: 'rect', x: cx + dx - 3, y: LOWER_ROW_MM - 2.5, width: 6, height: 5, fill: PALE, stroke: INK, strokeWidth: 0.4, anchor: 'centre' }));

const stripe = (width: number, y: number, height: number, fill: string): ArtShape => ({ kind: 'rect', x: 0, y, width, height, fill, anchor: 'stretch' });

/** The colour of the conductor a bar carries, across its middle, so a neutral bar is not taken for an earth bar. */
function barArt(def: ModuleDef, width: number): ArtShape[] {
  const conductor = def.id === 'pen-split-12' ? 'PEN' : (def.terminals?.[0]?.conductor ?? 'N');
  const body: ArtShape[] = [stripe(width, 40, 8, conductor === 'PE' ? '#2f9e44' : '#2f7de1')];
  if (conductor === 'PE') body.push(stripe(width, 42.5, 3, '#f2d21b'));
  if (conductor === 'PEN') body.push(stripe(width, 42.5, 3, '#2f9e44'));
  return [...body, ...screws()];
}

/** What is drawn on the face of a bundled device, or nothing for a kind that has no face worth drawing. */
export function genericArt(def: ModuleDef): ArtShape[] | undefined {
  const width = def.widthUnits * MODULE_UNIT_MM;
  const mid = width / 2;
  const shapes = ((): ArtShape[] => {
    switch (def.kind) {
      case 'breaker':
        return lever(width);
      case 'rcd':
      case 'rcbo':
        return [...lever(width), ...testButton(width)];
      case 'switch':
        return [
          { kind: 'rect', x: EDGE_MM, y: 2, width: width - 2 * EDGE_MM, height: 10.5, fill: '#facc15', ...stroked, anchor: 'stretch' },
          { kind: 'rect', x: mid - 7, y: 3.5, width: 14, height: 7.5, fill: '#dc2626', ...stroked, anchor: 'centre' },
        ];
      case 'contactor':
        return [
          bandWindow(width, INK),
          { kind: 'line', x1: 4, y1: 9.5, x2: 12, y2: 4.5, stroke: WHITE, strokeWidth: 0.8, anchor: 'left' },
          ...[74, 77.5].map((y): ArtShape => ({ kind: 'line', x1: 3, y1: y, x2: width - 3, y2: y, stroke: STEEL, strokeWidth: 0.6, anchor: 'stretch' })),
        ];
      case 'spd':
        return [
          bandWindow(width, '#16a34a'),
          { kind: 'polyline', points: [[mid - 3, 72], [mid + 1, 76], [mid - 1, 77], [mid + 3, 82]], stroke: '#dc2626', strokeWidth: 0.9, anchor: 'centre' },
        ];
      case 'meter':
        return [
          bandWindow(width, '#bbf7d0'),
          { kind: 'text', x: mid, y: 7, text: '00000', size: 5.5, fill: '#065f46', align: 'centre', bold: true, anchor: 'centre' },
          { kind: 'ellipse', cx: width - CORNER_MM, cy: LOWER_ROW_MM, rx: 1.6, ry: 1.6, fill: '#ef4444', ...stroked, anchor: 'right' },
        ];
      case 'psu':
        return [
          { kind: 'line', x1: mid - 3.5, y1: 5.5, x2: mid + 3.5, y2: 5.5, stroke: WHITE, strokeWidth: 0.9, anchor: 'centre' },
          { kind: 'line', x1: mid - 3.5, y1: 8.5, x2: mid + 3.5, y2: 8.5, stroke: WHITE, strokeWidth: 0.9, anchor: 'centre' },
          { kind: 'ellipse', cx: width - CORNER_MM, cy: LOWER_ROW_MM, rx: 1.8, ry: 1.8, fill: '#22c55e', ...stroked, anchor: 'right' },
          ...knob(CORNER_MM + 1, 'left'),
        ];
      case 'busbar':
      case 'terminal':
        return barArt(def, width);
      case 'relay':
        return relayArt(def, width);
      case 'other':
        return otherArt(def, width);
      default:
        return [];
    }
  })();
  return shapes.length > 0 ? shapes : undefined;
}

function relayArt(def: ModuleDef, width: number): ArtShape[] {
  const mid = width / 2;
  const shapes = [bandWindow(width, PALE), led('#22c55e', CORNER_MM + 1, 'left')];
  if (def.id.includes('time-switch')) shapes.push(...pushButtons(mid));
  if (/^(vrelay|phase-relay)|delay/.test(def.id)) shapes.push(...knob(mid, 'centre'));
  if (def.id.startsWith('twilight')) shapes.push({ kind: 'ellipse', cx: mid, cy: LOWER_ROW_MM, rx: 3.4, ry: 3.4, fill: '#facc15', stroke: '#a16207', strokeWidth: 0.4, anchor: 'centre' });
  return shapes;
}

function otherArt(def: ModuleDef, width: number): ArtShape[] {
  const mid = width / 2;
  if (def.id.startsWith('pilot-light')) return [{ kind: 'ellipse', cx: mid, cy: LOWER_ROW_MM - 1, rx: 4.5, ry: 4.5, fill: '#fecaca', stroke: '#b91c1c', strokeWidth: 0.6, anchor: 'centre' }];
  if (def.id.startsWith('din-socket')) {
    return [
      { kind: 'ellipse', cx: mid, cy: LOWER_ROW_MM - 2, rx: 6.5, ry: 6.5, fill: PALE, stroke: INK, strokeWidth: 0.6, anchor: 'centre' },
      { kind: 'ellipse', cx: mid - 2.4, cy: LOWER_ROW_MM - 2, rx: 1, ry: 1, fill: INK, anchor: 'centre' },
      { kind: 'ellipse', cx: mid + 2.4, cy: LOWER_ROW_MM - 2, rx: 1, ry: 1, fill: INK, anchor: 'centre' },
    ];
  }
  return [];
}
