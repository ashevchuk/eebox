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
import { exportLibraryJson } from './library/validate';
import type { Project } from './project';
import { loadAutosave, saveAutosave, type KeyValueStore } from './project/autosave';
import { bomToCsv, buildBom } from './project/bom';
import { parseProjectJson, projectWarnings, type ProjectFile, type ProjectParseResult } from './project/file';
import { SHARE_PREFIX, decodeShare, encodeShare } from './project/share';
import { emptySchematic, removeOrphanNodes } from './schematic/model';
import { confirmDialog } from './ui/dialog';
import { InspectorView } from './ui/inspectorView';
import { copyLibrary, newLibrary, uniqueId } from './ui/libraryEditor';
import { openLibraryEditor, type EditorOptions } from './ui/libraryEditorView';
import { initMenus } from './ui/menu';
import { PaletteView } from './ui/paletteView';
import { fillPrintSheet } from './ui/printSheet';
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
  const { placementId, combId, nodeId, wireId } = session.selection;
  deleteButton.disabled = !(session.mode === 'panel' ? placementId || combId : nodeId || wireId);
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
  activeView().pointerMove(e, worldPoint(e), isOverCanvas(e));
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
    downloadBlob(await renderToPng(activeView(), session), `${fileStem(session.project.panel.title, 'panel')}-${session.mode}.png`);
  } catch (error) {
    showStatus(`PNG export failed: ${(error as Error).message}`, true);
  }
}

function checkProject(): void {
  const problems = projectWarnings(session.project, session.resolve);
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

function exportSvg(): void {
  const stem = fileStem(session.project.panel.title, 'panel');
  downloadBlob(new Blob([renderToSvg(activeView(), session)], { type: 'image/svg+xml' }), `${stem}-${session.mode}.svg`);
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
    const outcome = await importLibraryText(storage, await file.text(), bundledLibraryId, (incoming, before, diff) => {
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
  onCopy: (library) => {
    const id = uniqueId(`my-${library.id}`, session.libraries.map((l) => l.id));
    openEditor(copyLibrary(library, id, `My ${library.name}`), { isNew: true, originalId: null });
  },
  isBundled: (library) => library.id === bundledLibraryId,
});

new ShelfView(byId('shelf'), session, (e, item) => panelView.startShelfDrag(e, item, worldPoint(e)));

const inspector = new InspectorView(byId('inspector-content'), session, (message) =>
  confirmDialog(message, 'Continue'),
);

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
byId('print').addEventListener('click', printProject);
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
for (const preset of ['source1', 'source3', 'load1', 'load3'] as const) {
  byId(`add-${preset}`).addEventListener('click', () => schematicView.addFreeNode(preset));
}
byId('check').addEventListener('click', checkProject);
byId('bundle-mode').addEventListener('click', () => {
  schematicView.bundleMode = !schematicView.bundleMode;
  syncUi();
});
byId('sync-modules').addEventListener('click', () => schematicView.syncModules());
byId('remove-orphans').addEventListener('click', removeOrphans);
undoButton.addEventListener('click', () => session.undo());
redoButton.addEventListener('click', () => session.redo());
new ResizeObserver(resizeCanvas).observe(stageWrap);
window.addEventListener('hashchange', () => void openSharedHash());

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
