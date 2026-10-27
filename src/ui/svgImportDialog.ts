import { ART_ANCHORS, MAX_ART_SHAPES, type ArtAnchor, type ArtShape } from '../library/art';
import { MAX_XML_LENGTH } from '../library/xml';
import { importSvg, type SvgImport } from '../library/svgImport';
import { MODULE_UNIT_MM, type ModuleDef } from '../library/types';
import { shapeElement, svgElement } from './artSvg';
import { FACE_HEIGHT_MM } from './artEditor';

const PREVIEW_SCALE_PX_PER_MM = 2.2;
const DEFAULT_MARGIN_MM = 2;
const DEFAULT_TOP_MM = 16;
const MIN_DEFAULT_WIDTH_MM = 4;

export interface SvgImportHost {
  module: ModuleDef;
  /** Shows a modal dialog on top of the designer. */
  openDialog(dialog: HTMLDialogElement): void;
  /** Receives the shapes the person accepted. */
  accept(shapes: ArtShape[]): void;
}

function field(label: string, control: HTMLElement): HTMLElement {
  const row = document.createElement('label');
  row.className = 'designer-form-row';
  row.append(label, control);
  return row;
}

function numberInput(value: number, min: number, max: number, step = 0.5): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.value = String(value);
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  return input;
}

/** Asks for an SVG, shows what it would put on the face and what it leaves out, and hands the shapes over when accepted. */
export function openSvgImportDialog(host: SvgImportHost): void {
  const { module } = host;
  const widthMm = module.widthUnits * MODULE_UNIT_MM;
  const dialog = document.createElement('dialog');
  dialog.className = 'app-dialog svg-import-dialog';
  const title = document.createElement('h2');
  title.textContent = 'Import an SVG onto the face';
  const help = document.createElement('p');
  help.textContent = `Lines, rectangles, circles, ellipses, polygons, paths and text are taken; images, scripts, styles, gradients, opacity and clipping are not. A file is read as text and nothing in it is run or fetched. At most ${Math.round(MAX_XML_LENGTH / 1024)} KB.`;

  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.svg,image/svg+xml';
  const pasted = document.createElement('textarea');
  pasted.placeholder = 'or paste the SVG here';
  pasted.rows = 4;
  const width = numberInput(Math.max(MIN_DEFAULT_WIDTH_MM, Math.round((widthMm - 2 * DEFAULT_MARGIN_MM) * 2) / 2), 1, 1000);
  const left = numberInput(DEFAULT_MARGIN_MM, -1000, 1000);
  const top = numberInput(DEFAULT_TOP_MM, -1000, 1000);
  const anchor = document.createElement('select');
  for (const a of ART_ANCHORS) anchor.append(new Option(a, a));
  const period = numberInput(1, 0.25, 1000, 0.25);
  const periodRow = field('Repeat every (units)', period);
  const preview = document.createElement('div');
  preview.className = 'svg-import-preview';
  const notes = document.createElement('ul');
  notes.className = 'svg-import-notes';
  const problem = document.createElement('div');
  problem.className = 'editor-errors';
  const actions = document.createElement('div');
  actions.className = 'app-dialog-actions';
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => dialog.close());
  const ok = document.createElement('button');
  ok.textContent = 'Import';
  ok.className = 'primary';
  ok.disabled = true;
  actions.append(cancel, ok);

  let text = '';
  let result: SvgImport | undefined;

  const drawPreview = (shapes: ArtShape[]) => {
    const k = PREVIEW_SCALE_PX_PER_MM;
    const svg = svgElement('svg', { width: widthMm * k, height: FACE_HEIGHT_MM * k, class: 'designer-svg' });
    svg.append(svgElement('rect', { x: 0, y: 0, width: widthMm * k, height: FACE_HEIGHT_MM * k, fill: '#e5e7eb', stroke: '#6b7280' }));
    const clip = svgElement('clipPath', { id: 'svg-import-clip' });
    clip.append(svgElement('rect', { x: 0, y: 0, width: widthMm * k, height: FACE_HEIGHT_MM * k }));
    const group = svgElement('g', { 'clip-path': 'url(#svg-import-clip)' });
    for (const shape of shapes) group.append(shapeElement({ ...shape, anchor: undefined, period: undefined } as ArtShape, k));
    svg.append(clip, group);
    preview.replaceChildren(svg);
  };

  const update = () => {
    problem.textContent = '';
    notes.replaceChildren();
    periodRow.style.display = anchor.value === 'tile' ? '' : 'none';
    if (text.trim() === '') {
      result = undefined;
      preview.replaceChildren();
      ok.disabled = true;
      return;
    }
    result = importSvg(text, {
      widthMm: Number(width.value),
      leftMm: Number(left.value),
      topMm: Number(top.value),
      anchor: anchor.value as ArtAnchor,
      period: Number(period.value),
      room: MAX_ART_SHAPES - (module.art?.length ?? 0),
    });
    if (!result.ok) {
      problem.textContent = result.message;
      preview.replaceChildren();
      ok.disabled = true;
      return;
    }
    drawPreview(result.shapes);
    for (const note of result.notes) notes.append(Object.assign(document.createElement('li'), { textContent: note }));
    ok.disabled = false;
  };

  file.addEventListener('change', async () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    if (chosen.size > MAX_XML_LENGTH) {
      text = '';
      update();
      problem.textContent = `The file is larger than ${Math.round(MAX_XML_LENGTH / 1024)} KB.`;
      return;
    }
    text = await chosen.text();
    pasted.value = '';
    update();
  });
  pasted.addEventListener('input', () => {
    text = pasted.value;
    update();
  });
  for (const input of [width, left, top, period]) input.addEventListener('input', update);
  anchor.addEventListener('change', update);
  ok.addEventListener('click', () => {
    if (!result?.ok) return;
    const shapes = result.shapes;
    dialog.close();
    host.accept(shapes);
  });

  dialog.append(
    title,
    help,
    field('File', file),
    pasted,
    field('Width on the face (mm)', width),
    field('Left (mm)', left),
    field('Top (mm)', top),
    field('On other widths', anchor),
    periodRow,
    preview,
    notes,
    problem,
    actions,
  );
  periodRow.style.display = 'none';
  host.openDialog(dialog);
}
