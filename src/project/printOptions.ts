export const PRINT_PARTS = ['panel', 'schematic', 'parts', 'circuits', 'connections', 'ferrules'] as const;
export type PrintPart = (typeof PRINT_PARTS)[number];

export const PRINT_PART_NAMES: Record<PrintPart, string> = {
  panel: 'Panel layout',
  schematic: 'Wiring schematic',
  parts: 'Parts list',
  circuits: 'Circuits',
  connections: 'Connections',
  ferrules: 'Ferrules',
};

export const PAPER_SIZES_MM = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  Letter: { width: 215.9, height: 279.4 },
} as const;
export type Paper = keyof typeof PAPER_SIZES_MM;
export type Orientation = 'landscape' | 'portrait';

export interface PrintOptions {
  parts: Record<PrintPart, boolean>;
  paper: Paper;
  orientation: Orientation;
}

export const PAGE_MARGIN_MM = 10;
/** Room taken from the page height by the title, the caption and the spacing around a drawing. */
const DRAWING_FURNITURE_MM = 40;

export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  parts: { panel: true, schematic: true, parts: true, circuits: true, connections: true, ferrules: true },
  paper: 'A4',
  orientation: 'landscape',
};

export function pageSizeMm(options: Pick<PrintOptions, 'paper' | 'orientation'>): { width: number; height: number } {
  const { width, height } = PAPER_SIZES_MM[options.paper];
  return options.orientation === 'landscape' ? { width: height, height: width } : { width, height };
}

/** The `@page` rule that makes the browser print on this paper. */
export function pageRule(options: Pick<PrintOptions, 'paper' | 'orientation'>): string {
  return `@page { size: ${options.paper} ${options.orientation}; margin: ${PAGE_MARGIN_MM}mm; }`;
}

/** The tallest a drawing may be so that it, its caption and the title fit on one page. */
export function drawingMaxHeightMm(options: Pick<PrintOptions, 'paper' | 'orientation'>): number {
  return pageSizeMm(options).height - 2 * PAGE_MARGIN_MM - DRAWING_FURNITURE_MM;
}

export const anythingToPrint = (options: PrintOptions): boolean => PRINT_PARTS.some((part) => options.parts[part]);
