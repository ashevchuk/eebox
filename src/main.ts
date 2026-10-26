import genericIecText from '../libraries/generic-iec.json?raw';
import { createPanel } from './layout/panel';
import type { ModuleRef } from './layout/placement';
import {
  IndexedDbLibraryStorage,
  MemoryLibraryStorage,
  importLibraryText,
  seedBundledLibrary,
  type LibraryStorage,
} from './library/storage';
import type { Library, ModuleDef } from './library/types';
import type { ValidationError } from './library/validate';
import { GENERIC_LIBRARY_ID } from './library/genericSeries';
import { describeDiff } from './library/compare';
import { libraryFromCsv } from './library/csvImport';
import { exportLibraryJson } from './library/validate';
import type { Project } from './project';
import { loadAutosave, saveAutosave, type KeyValueStore } from './project/autosave';
import { bomToCsv, buildBom } from './project/bom';
import { parseProjectJson, projectWarnings, type ProjectFile, type ProjectParseResult } from './project/file';
import { loadCableSettings, saveCableSettings } from './project/cableSettingsStorage';
import { loadColourChoice, saveColourChoice } from './project/colourSchemeStorage';
import { DEFAULT_COLOUR_CHOICE, coloursOf, type ColourChoice } from './view/colourScheme';
import { SHARE_PREFIX, decodeShare, encodeShare } from './project/share';
import { emptySchematic, removeOrphanNodes } from './schematic/model';
import { confirmDialog } from './ui/dialog';
import { InspectorView } from './ui/inspectorView';
import { copyLibrary, newLibrary, uniqueId } from './ui/libraryEditor';
import { openLibraryEditor, type EditorOptions } from './ui/libraryEditorView';
import { circuitSchedule, ferruleCounts, scheduleToCsv, wireEndLabels, wireEndLabelsToCsv, wireList, wireListToCsv } from './electrical/schedule';
import { LIGHT_THEME, setColourScheme } from './view/theme';
import { fillLabelSheet } from './ui/labelSheet';
import { MY_LIBRARY_ID, emptyMyLibrary } from './library/myModules';
import { openModuleDesigner } from './ui/moduleDesignerView';
import { MODULE_TEMPLATES } from './ui/moduleTemplates';
import { EXAMPLES } from './examples';
import { chooseExample } from './ui/examplesDialog';
import { editCableSettings } from './ui/cableSettingsDialog';
import { chooseColours } from './ui/colourDialog';
import { initMenus } from './ui/menu';
import { PaletteView } from './ui/paletteView';
import { fillPrintSheet } from './ui/printSheet';
import { selectedIds, selectedWires } from './ui/selection';
import { fillTileSheet } from './ui/tileSheet';
import { ShelfView } from './ui/shelfView';
import { fileStem } from './project/names';
import { downloadBlob } from './ui/download';
import { renderToPng, renderToSvg } from './ui/exportImage';
import { PanelEditor } from './ui/panelEditor';
import { PanelView } from './ui/panelView';
import { SchematicView } from './ui/schematicView';
import { Session, type Mode } from './ui/session';
import type { View } from './ui/view';
import type { Point } from './view/Camera';

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = byId<HTMLCanvasElement>('stage');
const stageWrap = byId<HTMLElement>('stage-wrap');
const enclosureSelect = byId<HTMLSelectElement>('enclosure');
const statusEl = byId<HTMLElement>('status');
const undoButton = byId<HTMLButtonElement>('undo');
const redoButton = byId<HTMLButtonElement>('redo');
const deleteButton = byId<HTMLButtonElement>('delete-selection');
const ctx = canvas.getContext('2d')!;

const bundledLibraryId = GENERIC_LIBRARY_ID;
const storage: LibraryStorage =
  typeof indexedDB === 'undefined' ? new MemoryLibraryStorage() : new IndexedDbLibraryStorage();
const session = new Session();
const panelView = new PanelView(session);
const schematicView = new SchematicView(session);
const views: Record<Mode, View> = { panel: panelView, schematic: schematicView };
const fittedModes = new Set<Mode>();
new PanelEditor(byId('panel-settings'), session);

let panFrom: Point | null = null;
let spaceHeld = false;
let renderQueued = false;

const activeView = (): View => views[session.mode];

const STATUS_TTL_MS = 8000;
let statusTimer: number | undefined;

function showStatus(message: string, isError = false): void {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
  window.clearTimeout(statusTimer);
  if (message) statusTimer = window.setTimeout(() => showStatus(''), STATUS_TTL_MS);
}
session.notify = showStatus;

function requestRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    activeView().draw(ctx, stageWrap.clientWidth, stageWrap.clientHeight, window.devicePixelRatio || 1);
  });
}

function syncUi(): void {
  undoButton.disabled = !session.canUndo;
  redoButton.disabled = !session.canRedo;
  document.body.dataset.mode = session.mode;
  const { title } = session.project.panel;
  document.title = title ? `${title} - eebox` : 'eebox';
  byId('mode-panel').classList.toggle('active', session.mode === 'panel');
  byId('mode-schematic').classList.toggle('active', session.mode === 'schematic');
  byId('bundle-mode').classList.toggle('active', schematicView.bundleMode);
  byId('ruler').classList.toggle('active', session.ruler.on);
  canvas.style.cursor = session.mode === 'panel' && session.ruler.on ? 'crosshair' : '';
  const { nodeId } = session.selection;
  const chosen = selectedIds(session.selection);
  deleteButton.disabled = !(session.mode === 'panel' ? chosen.placements.length + chosen.combs.length > 0 : nodeId || selectedWires(session.selection).length > 0);
}

session.subscribe(() => {
  syncUi();
  requestRender();
});

function resizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(stageWrap.clientWidth * dpr);
  canvas.height = Math.round(stageWrap.clientHeight * dpr);
  requestRender();
}

function fitView(mode: Mode = session.mode): void {
  views[mode].camera.fit(views[mode].fitBounds(), stageWrap.clientWidth, stageWrap.clientHeight);
  fittedModes.add(mode);
  requestRender();
}

function setMode(mode: Mode): void {
  showStatus('');
  session.mode = mode;
  if (!fittedModes.has(mode)) fitView(mode);
  session.changed();
}

function worldPoint(e: PointerEvent | MouseEvent): Point {
  const rect = canvas.getBoundingClientRect();
  return activeView().camera.screenToWorld(
    { x: e.clientX - rect.left, y: e.clientY - rect.top },
    stageWrap.clientWidth,
    stageWrap.clientHeight,
  );
}

function isOverCanvas(e: PointerEvent): boolean {
  const rect = canvas.getBoundingClientRect();
  return e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  if (e.button === 1 || (e.button === 0 && spaceHeld)) {
    panFrom = { x: e.clientX, y: e.clientY };
    return;
  }
  if (e.button !== 0) return;
  if (!activeView().pointerDown(e, worldPoint(e))) panFrom = { x: e.clientX, y: e.clientY };
});

window.addEventListener('pointermove', (e) => {
  if (panFrom) {
    activeView().camera.pan(e.clientX - panFrom.x, e.clientY - panFrom.y);
    panFrom = { x: e.clientX, y: e.clientY };
    requestRender();
  }
  const world = worldPoint(e);
  activeView().pointerMove(e, world, isOverCanvas(e));
  if (isOverCanvas(e) && !(session.mode === 'panel' && session.ruler.on)) canvas.style.cursor = activeView().cursorAt?.(world) ?? '';
});

window.addEventListener('pointerup', (e) => {
  panFrom = null;
  activeView().pointerUp(e, worldPoint(e));
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    activeView().camera.zoomAt(
      { x: e.clientX - rect.left, y: e.clientY - rect.top },
      Math.exp(-e.deltaY * 0.0015),
      stageWrap.clientWidth,
      stageWrap.clientHeight,
    );
    requestRender();
  },
  { passive: false },
);

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
  const mod = e.ctrlKey || e.metaKey;
  if (e.code === 'Space') {
    spaceHeld = true;
    e.preventDefault();
  } else if (mod && e.code === 'KeyZ') {
    e.preventDefault();
    if (e.shiftKey) session.redo();
    else session.undo();
  } else if (mod && e.code === 'KeyY') {
    e.preventDefault();
    session.redo();
  } else if (mod && session.mode === 'panel' && ['KeyC', 'KeyV', 'KeyD', 'KeyA'].includes(e.code)) {
    e.preventDefault();
    if (e.code === 'KeyC') panelView.copySelection();
    else if (e.code === 'KeyV') panelView.paste();
    else if (e.code === 'KeyD') panelView.duplicateSelection();
    else panelView.selectAll();
  } else if (e.code === 'KeyR' && !mod && session.mode === 'panel') {
    session.ruler = { on: !session.ruler.on, line: null };
    session.changed();
  } else if (e.code === 'Escape' && activeView().cancel?.()) {
    e.preventDefault();
  } else if (e.code === 'Escape' && session.ruler.on) {
    session.ruler = { on: false, line: null };
    session.changed();
  } else if (e.code === 'Delete' || e.code === 'Backspace') {
    activeView().deleteSelection();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') spaceHeld = false;
});

function renderEnclosureSelect(): void {
  const previous = enclosureSelect.value;
  enclosureSelect.replaceChildren();
  for (const library of session.libraries) {
    for (const enclosure of library.enclosures) {
      const option = document.createElement('option');
      option.value = `${library.id}/${enclosure.id}`;
      option.textContent = enclosure.name;
      enclosureSelect.append(option);
    }
  }
  if (previous) enclosureSelect.value = previous;
}

async function refreshLibraries(): Promise<void> {
  session.libraries = await storage.list();
  palette.render();
  renderEnclosureSelect();
  session.changed();
}

async function newPanel(): Promise<void> {
  const [libraryId, enclosureId] = enclosureSelect.value.split('/');
  const enclosure = session.libraries
    .find((l) => l.id === libraryId)
    ?.enclosures.find((enc) => enc.id === enclosureId);
  if (!enclosure) {
    showStatus('No enclosure available: import a library that defines one.', true);
    return;
  }
  if (!(await confirmDiscard())) return;
  session.reset({
    panel: createPanel(enclosure.railLengthsUnits),
    schematic: emptySchematic(),
  });
  fitView('panel');
}

function downloadLibrary(library: Library): void {
  downloadBlob(new Blob([exportLibraryJson(library)], { type: 'application/json' }), `${library.id}.json`);
}

const hasWork = (project: Project): boolean =>
  project.panel.placements.length > 0 || project.schematic.nodes.length > 0;

async function confirmDiscard(): Promise<boolean> {
  if (!hasWork(session.project)) return true;
  return confirmDialog('Discard the current panel and schematic?', 'Discard');
}

function describeErrors(source: string, errors: ValidationError[]): string[] {
  const shown = errors.slice(0, 5).map((err) => `${source} ${err.path || '(root)'}: ${err.message}`);
  const hidden = errors.length - shown.length;
  return hidden > 0 ? [...shown, `${source}: ${hidden} more errors`] : shown;
}

function applyLoaded(file: ProjectFile, warnings: string[], source: string): void {
  session.load(file);
  fittedModes.clear();
  fitView();
  const detail = warnings.slice(0, 5).join('\n');
  showStatus(warnings.length > 0 ? `${source} loaded with problems:\n${detail}` : `${source} loaded.`, warnings.length > 0);
}

async function shareLink(): Promise<void> {
  const url = `${location.href.split('#')[0]}${SHARE_PREFIX}${await encodeShare(session.toFile())}`;
  history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url);
    showStatus(`Share link copied (${url.length} characters).`);
  } catch {
    showStatus('Share link is in the address bar; the clipboard is unavailable here.');
  }
}

async function openSharedHash(): Promise<void> {
  if (!location.hash.startsWith(SHARE_PREFIX)) return;
  const result = await decodeShare(location.hash.slice(SHARE_PREFIX.length));
  history.replaceState(null, '', location.href.split('#')[0]);
  if (!result.ok) showStatus(describeErrors('Share link', result.errors).join('\n'), true);
  else if (await confirmDiscard()) applyLoaded(result.file, result.warnings, 'Shared project');
}

async function exportPng(): Promise<void> {
  try {
    downloadBlob(await renderToPng(activeView(), session, LIGHT_THEME), `${fileStem(session.project.panel.title, 'panel')}-${session.mode}.png`);
  } catch (error) {
    showStatus(`PNG export failed: ${(error as Error).message}`, true);
  }
}

function checkProject(): void {
  const problems = projectWarnings(session.project, session.resolve, session.cableSettings);
  if (problems.length === 0) {
    showStatus('Check passed: no problems found.');
    return;
  }
  const shown = problems.slice(0, 6);
  const hidden = problems.length - shown.length;
  showStatus([...shown, ...(hidden > 0 ? [`${hidden} more`] : [])].join('\n'), true);
}

function printProject(): void {
  const sheet = byId('print-sheet');
  fillPrintSheet(sheet, session, views);
  window.addEventListener('afterprint', () => sheet.replaceChildren(), { once: true });
  window.print();
}

function removeOrphans(): void {
  const { project } = session;
  const { schematic, removed, keptWired } = removeOrphanNodes(project.schematic, project.panel);
  if (removed > 0) session.commit({ ...project, schematic });
  const nodes = (n: number) => `${n} orphaned node${n === 1 ? '' : 's'}`;
  const stayed = `${nodes(keptWired)} with wires stayed: delete them yourself if the wires are not needed.`;
  if (removed === 0) showStatus(keptWired > 0 ? `Nothing to remove: ${stayed}` : 'There are no orphaned nodes.', keptWired > 0);
  else showStatus(`Removed ${nodes(removed)}.${keptWired > 0 ? ` ${stayed}` : ''}`, keptWired > 0);
}

function printFullSize(): void {
  const sheet = byId('print-sheet');
  fillTileSheet(sheet, session, views.panel);
  window.addEventListener('afterprint', () => sheet.replaceChildren(), { once: true });
  window.print();
}

function printLabels(): void {
  const sheet = byId('print-sheet');
  fillLabelSheet(sheet, session);
  window.addEventListener('afterprint', () => sheet.replaceChildren(), { once: true });
  window.print();
}

function exportSvg(): void {
  const stem = fileStem(session.project.panel.title, 'panel');
  downloadBlob(new Blob([renderToSvg(activeView(), session, LIGHT_THEME)], { type: 'image/svg+xml' }), `${stem}-${session.mode}.svg`);
}

function exportCircuits(): void {
  const { project } = session;
  const circuits = circuitSchedule(project, session.resolve, session.cableSettings);
  const ferrules = ferruleCounts(project);
  if (circuits.length === 0 && ferrules.length === 0) {
    showStatus('There are no loads with a power and no wires yet.');
    return;
  }
  const stem = fileStem(project.panel.title, 'panel');
  downloadBlob(new Blob(['\uFEFF', scheduleToCsv(circuits, ferrules)], { type: 'text/csv;charset=utf-8' }), `${stem}-circuits.csv`);
}

function exportWireLabels(): void {
  const labels = wireEndLabels(wireList(session.project, session.resolve));
  if (labels.length === 0) {
    showStatus('There are no wires yet.');
    return;
  }
  const stem = fileStem(session.project.panel.title, 'panel');
  downloadBlob(new Blob(['\uFEFF', wireEndLabelsToCsv(labels)], { type: 'text/csv;charset=utf-8' }), `${stem}-wire-labels.csv`);
  showStatus(`${labels.length} labels saved.`);
}

function exportWires(): void {
  const rows = wireList(session.project, session.resolve);
  if (rows.length === 0) {
    showStatus('There are no wires yet.');
    return;
  }
  const stem = fileStem(session.project.panel.title, 'panel');
  downloadBlob(new Blob(['\uFEFF', wireListToCsv(rows)], { type: 'text/csv;charset=utf-8' }), `${stem}-wires.csv`);
}

function exportBom(): void {
  const rows = buildBom(session.project.panel, session.resolve);
  if (rows.length === 0) {
    showStatus('Nothing is placed on the panel yet.');
    return;
  }
  const stem = fileStem(session.project.panel.title, 'panel');
  downloadBlob(new Blob(['\uFEFF', bomToCsv(rows)], { type: 'text/csv;charset=utf-8' }), `${stem}-bom.csv`);
}

function openDesigner(library: Library, moduleId: string, options: { isNew: boolean; offerTemplates?: boolean }): void {
  openModuleDesigner(library, { moduleId, ...options }, {
    save: async (saved) => {
      await storage.put(saved);
      await refreshLibraries();
    },
    askConfirmation: (message, confirmLabel) => confirmDialog(message, confirmLabel),
  });
}

/** The user's own library as a draft to put a new module in; it is created when it does not exist yet. */
function myLibraryDraft(): Library {
  return structuredClone(session.libraries.find((l) => l.id === MY_LIBRARY_ID) ?? emptyMyLibrary());
}

function designNewModule(): void {
  const draft = myLibraryDraft();
  const id = uniqueId('new-module', draft.modules.map((m) => m.id));
  draft.modules.push(MODULE_TEMPLATES[0]!.build(id));
  openDesigner(draft, id, { isNew: true, offerTemplates: true });
}

function designCopyOf(def: ModuleDef): void {
  const draft = myLibraryDraft();
  const id = uniqueId(`${def.id}-copy`, draft.modules.map((m) => m.id));
  draft.modules.push({ ...structuredClone(def), id, name: `${def.name} (copy)` });
  openDesigner(draft, id, { isNew: true });
}

/** A module of a library the user owns is edited in place; one of the bundled library is copied first. */
function designModuleOf(ref: ModuleRef): void {
  const library = session.libraries.find((l) => l.id === ref.libraryId);
  const stored = library?.modules.find((m) => m.id === ref.moduleId);
  if (library && stored && library.id !== bundledLibraryId) return openDesigner(structuredClone(library), stored.id, { isNew: false });
  const def = session.resolve(ref);
  if (def) designCopyOf(def);
  else showStatus('That module is not in any library, so it cannot be edited.', true);
}

function openEditor(library: Library, options: EditorOptions): void {
  openLibraryEditor(library, options, {
    libraries: () => session.libraries,
    bundledId: bundledLibraryId,
    save: async (saved, replacesId) => {
      await storage.put(saved);
      if (replacesId && replacesId !== saved.id) await storage.remove(replacesId);
      await refreshLibraries();
    },
    exportLibrary: downloadLibrary,
    askConfirmation: (message, confirmLabel) => confirmDialog(message, confirmLabel),
  });
}

async function removeLibrary(library: Library): Promise<void> {
  await storage.remove(library.id);
  await refreshLibraries();
}

async function importFiles(files: FileList | File[]): Promise<void> {
  const lines: string[] = [];
  let failed = false;
  for (const file of files) {
    const source = await file.text();
    let libraryText = source;
    if (/\.csv$/i.test(file.name)) {
      const stem = file.name.replace(/\.csv$/i, '');
      const converted = libraryFromCsv(source, { id: stem.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '') || 'parts', name: stem });
      if (!converted.ok) {
        failed = true;
        lines.push(...describeErrors(file.name, converted.errors));
        continue;
      }
      libraryText = JSON.stringify(converted.library);
    }
    const outcome = await importLibraryText(storage, libraryText, bundledLibraryId, (incoming, before, diff) => {
      const versions = `${before.version ?? 'no version'} to ${incoming.version ?? 'no version'}`;
      return confirmDialog(
        `Replace "${incoming.name}" (${versions})? ${describeDiff(diff)}. Projects keep their own copy of each module until you update them.`,
        'Replace',
      );
    });
    if (outcome.kind === 'invalid') {
      failed = true;
      lines.push(...describeErrors(file.name, outcome.errors));
    } else if (outcome.kind === 'reserved') {
      failed = true;
      lines.push(`${file.name}: the id "${outcome.library.id}" belongs to the bundled library; give yours another id.`);
    } else {
      const { name } = outcome.library;
      const text = {
        same: `"${name}" is already up to date.`,
        imported: `Imported "${name}".`,
        replaced: `Replaced "${name}".`,
        kept: `Kept the existing "${name}".`,
      }[outcome.kind];
      lines.push(text);
    }
  }
  await refreshLibraries();
  showStatus(lines.join('\n'), failed);
}

byId<HTMLInputElement>('import').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  if (input.files) void importFiles(input.files).then(() => (input.value = ''));
});

const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
stageWrap.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  stageWrap.classList.add('drop');
});
stageWrap.addEventListener('dragleave', () => stageWrap.classList.remove('drop'));
stageWrap.addEventListener('drop', (e) => {
  stageWrap.classList.remove('drop');
  if (!hasFiles(e) || !e.dataTransfer) return;
  e.preventDefault();
  void importFiles(e.dataTransfer.files);
});

byId<HTMLInputElement>('open-project').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const text = await file.text();
  input.value = '';
  const result = parseProjectJson(text);
  if (!result.ok) showStatus(describeErrors(file.name, result.errors).join('\n'), true);
  else if (await confirmDiscard()) applyLoaded(result.file, result.warnings, file.name);
});

const palette = new PaletteView(byId('palette'), byId<HTMLInputElement>('palette-search'), session, {
  onDragStart: (e, def, ref) => panelView.startPaletteDrag(e, def, ref, worldPoint(e)),
  onExport: downloadLibrary,
  onRemove: (library) => void removeLibrary(library),
  onEdit: (library) => openEditor(structuredClone(library), { isNew: false, originalId: library.id }),
  onEditModule: (library, def) => designModuleOf({ libraryId: library.id, moduleId: def.id }),
  onCopyModule: (_library, def) => designCopyOf(def),
  onCopy: (library) => {
    const id = uniqueId(`my-${library.id}`, session.libraries.map((l) => l.id));
    openEditor(copyLibrary(library, id, `My ${library.name}`), { isNew: true, originalId: null });
  },
  isBundled: (library) => library.id === bundledLibraryId,
});

new ShelfView(byId('shelf'), session, (e, item) => panelView.startShelfDrag(e, item, worldPoint(e)));

const inspector = new InspectorView(byId('inspector-content'), session, (message) => confirmDialog(message, 'Continue'), designModuleOf);

// Commit a typed value before a click elsewhere changes the selection under it.
window.addEventListener(
  'pointerdown',
  () => {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && inspector.owns(active)) active.blur();
  },
  true,
);

deleteButton.addEventListener('click', () => activeView().deleteSelection());

initMenus();
byId('cable-settings').addEventListener('click', async () => {
  const edited = await editCableSettings(session.cableSettings);
  if (!edited) return;
  session.cableSettings = edited;
  if (autosaveStore && !saveCableSettings(autosaveStore, edited)) showStatus('Cable settings are used now but could not be stored.', true);
  session.changed();
});
let colourChoice: ColourChoice = DEFAULT_COLOUR_CHOICE;
byId('colour-scheme').addEventListener('click', async () => {
  const chosen = await chooseColours(colourChoice);
  if (!chosen) return;
  colourChoice = chosen;
  setColourScheme(coloursOf(chosen));
  if (autosaveStore && !saveColourChoice(autosaveStore, chosen)) showStatus('The colours are used now but could not be stored.', true);
  session.changed();
});
byId('open-example').addEventListener('click', async () => {
  const example = await chooseExample(EXAMPLES);
  if (!example) return;
  const result = parseProjectJson(example.text);
  if (!result.ok) showStatus(describeErrors(example.title, result.errors).join('\n'), true);
  else if (await confirmDiscard()) applyLoaded(result.file, result.warnings, example.title);
});
byId('print').addEventListener('click', printProject);
byId('new-module').addEventListener('click', designNewModule);
byId('print-labels').addEventListener('click', printLabels);
byId('print-full-size').addEventListener('click', printFullSize);
byId('new-library').addEventListener('click', () =>
  openEditor(newLibrary(uniqueId('my-library', session.libraries.map((l) => l.id)), 'My library'), {
    isNew: true,
    originalId: null,
  }),
);
byId('mode-panel').addEventListener('click', () => setMode('panel'));
byId('mode-schematic').addEventListener('click', () => setMode('schematic'));
byId('new-panel').addEventListener('click', () => void newPanel());
byId('fit').addEventListener('click', () => fitView());
byId('ruler').addEventListener('click', () => {
  session.ruler = { on: !session.ruler.on, line: null };
  session.changed();
});
byId('save-project').addEventListener('click', () =>
  downloadBlob(
    new Blob([JSON.stringify(session.toFile(), null, 2)], { type: 'application/json' }),
    `${fileStem(session.project.panel.title, 'panel')}.eebox.json`,
  ),
);
byId('share-link').addEventListener('click', () => void shareLink());
byId('export-png').addEventListener('click', () => void exportPng());
byId('export-svg').addEventListener('click', exportSvg);
byId('export-bom').addEventListener('click', exportBom);
byId('export-circuits').addEventListener('click', exportCircuits);
byId('export-wires').addEventListener('click', exportWires);
byId('export-wire-labels').addEventListener('click', exportWireLabels);
for (const preset of ['source1', 'source3', 'load1', 'load3'] as const) {
  byId(`add-${preset}`).addEventListener('click', () => {
    schematicView.addFreeNode(preset);
    fitView('schematic');
  });
}
byId('check').addEventListener('click', checkProject);
byId('bundle-mode').addEventListener('click', () => {
  schematicView.bundleMode = !schematicView.bundleMode;
  syncUi();
});
byId('sync-modules').addEventListener('click', () => schematicView.syncModules());
byId('route-automatically').addEventListener('click', () => schematicView.routeAllAutomatically());
byId('spread-wires').addEventListener('click', () => schematicView.spreadWires());
byId('remove-orphans').addEventListener('click', removeOrphans);
undoButton.addEventListener('click', () => session.undo());
redoButton.addEventListener('click', () => session.redo());
new ResizeObserver(resizeCanvas).observe(stageWrap);
window.addEventListener('hashchange', () => void openSharedHash());

/** The panels beside the drawing can be hidden, and start hidden in a narrow window; the choice is kept. */
const PANEL_KEYS = { sidebar: 'eebox:hide-sidebar', inspector: 'eebox:hide-inspector' } as const;
const NARROW_WINDOW_PX = 1100;

const chosenHidden: Partial<Record<keyof typeof PANEL_KEYS, boolean>> = {};

function panelHidden(name: keyof typeof PANEL_KEYS): boolean {
  const chosen = chosenHidden[name];
  if (chosen !== undefined) return chosen;
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(PANEL_KEYS[name]);
  } catch {
    stored = null;
  }
  return stored === null ? window.innerWidth < NARROW_WINDOW_PX : stored === 'yes';
}

function showPanels(): void {
  for (const name of ['sidebar', 'inspector'] as const) {
    document.body.classList.toggle(`hide-${name}`, panelHidden(name));
    byId(`toggle-${name}`).classList.toggle('active', !panelHidden(name));
  }
}

for (const name of ['sidebar', 'inspector'] as const) {
  byId(`toggle-${name}`).addEventListener('click', () => {
    chosenHidden[name] = !panelHidden(name);
    try {
      window.localStorage.setItem(PANEL_KEYS[name], chosenHidden[name] ? 'yes' : 'no');
    } catch {
      // The choice then holds for this visit only.
    }
    showPanels();
  });
}
showPanels();

const autosaveStore: KeyValueStore | null = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
const AUTOSAVE_DELAY_MS = 500;

/** Only started after the initial project is restored, so the empty startup state cannot overwrite a saved one. */
function startAutosave(store: KeyValueStore): void {
  let lastSaved: object | null = null;
  let timer: number | undefined;
  session.subscribe(() => {
    if (session.revision === lastSaved) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      lastSaved = session.revision;
      if (!saveAutosave(store, session.toFile())) showStatus('Autosave failed: browser storage is unavailable or full.', true);
    }, AUTOSAVE_DELAY_MS);
  });
}

async function restoreInitialProject(stored: ProjectParseResult | null): Promise<void> {
  const shared = location.hash.startsWith(SHARE_PREFIX)
    ? await decodeShare(location.hash.slice(SHARE_PREFIX.length))
    : null;
  if (shared) history.replaceState(null, '', location.href.split('#')[0]);
  if (shared?.ok) {
    const storedHasWork = stored?.ok === true && hasWork(stored.file.project);
    const replace = () => confirmDialog('Open the shared project and replace your autosaved one?', 'Open shared project');
    if (!storedHasWork || (await replace())) {
      applyLoaded(shared.file, shared.warnings, 'Shared project');
      return;
    }
  } else if (shared) {
    showStatus(describeErrors('Share link', shared.errors).join('\n'), true);
  }
  if (stored?.ok) {
    applyLoaded(stored.file, stored.warnings, 'Autosave');
    return;
  }
  if (stored) showStatus(describeErrors('Autosave ignored:', stored.errors).join('\n'), true);
  await newPanel();
}

async function init(): Promise<void> {
  const stored = autosaveStore ? loadAutosave(autosaveStore) : null;
  if (autosaveStore) {
    const { settings, problem } = loadCableSettings(autosaveStore);
    session.cableSettings = settings;
    if (problem) showStatus(problem, true);
    const colours = loadColourChoice(autosaveStore);
    colourChoice = colours.choice;
    setColourScheme(coloursOf(colours.choice));
    if (colours.problem) showStatus(colours.problem, true);
  }
  try {
    await seedBundledLibrary(storage, genericIecText);
    await refreshLibraries();
  } catch (error) {
    showStatus(`Library storage failed: ${(error as Error).message}`, true);
  }
  resizeCanvas();
  await restoreInitialProject(stored);
  if (autosaveStore) startAutosave(autosaveStore);
}

void init();
