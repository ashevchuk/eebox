export const PANEL_TEXTS = ['title', 'rowLabels', 'moduleLabels', 'combLabels', 'ratings', 'moduleNames', 'faceText'] as const;
export const SCHEMATIC_TEXTS = ['nodeLabels', 'terminalNames', 'earthing', 'wireLabels', 'currents'] as const;
/** Text of the print sheet around the drawings; it has no place on the screen. */
export const SHEET_TEXTS = ['sheetTitle', 'captions'] as const;
export const TEXT_KINDS = [...PANEL_TEXTS, ...SCHEMATIC_TEXTS, ...SHEET_TEXTS] as const;
export type TextKind = (typeof TEXT_KINDS)[number];

/** Which kinds of text a drawing shows. */
export type TextVisibility = Record<TextKind, boolean>;

export const TEXT_NAMES: Record<TextKind, string> = {
  title: 'Title of the drawing',
  rowLabels: 'Row labels',
  moduleLabels: 'Module labels',
  combLabels: 'Comb labels',
  ratings: 'Ratings on modules (B16)',
  moduleNames: 'Names on modules',
  faceText: 'Text drawn on module faces',
  nodeLabels: 'Node names',
  terminalNames: 'Terminal names',
  earthing: 'Earthing system on sources',
  wireLabels: 'Wire labels',
  currents: 'Currents on wires',
  sheetTitle: 'Title and headings of the lists',
  captions: 'Captions under the drawings',
};

const withAll = (shown: boolean): TextVisibility => Object.fromEntries(TEXT_KINDS.map((kind) => [kind, shown])) as TextVisibility;

export const ALL_TEXT: TextVisibility = withAll(true);
export const NO_TEXT: TextVisibility = withAll(false);

/** What was stored: a kind that is missing, or not a yes or no, is shown; anything unreadable gives all text. */
export function parseTextVisibility(stored: string | null): TextVisibility {
  if (stored === null) return ALL_TEXT;
  try {
    const raw = JSON.parse(stored) as Record<string, unknown> | null;
    if (raw === null || typeof raw !== 'object') return ALL_TEXT;
    return Object.fromEntries(TEXT_KINDS.map((kind) => [kind, raw[kind] !== false])) as TextVisibility;
  } catch {
    return ALL_TEXT;
  }
}
