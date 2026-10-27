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
import { AUTOSAVE_KEY, loadAutosave, saveAutosave, serializeAutosave, type KeyValueStore } from './project/autosave';
import { TabGuard } from './project/tabGuard';
import { bomToCsv, buildBom } from './project/bom';
import { emptyHint } from './ui/help';
import { openHelpDialog } from './ui/helpDialog';
import { IndexedDbProjectStore, MemoryProjectStore, SNAPSHOT_INTERVAL_MS, newProjectId, newSnapshotId, planProjectImport, savedProjects, snapshotsToDrop, type ProjectStore } from './project/projectStore';
import { SETTING_KEYS, buildWorkspace, parseWorkspace, workspaceToText } from './project/workspace';
import { openProjectsDialog } from './ui/projectsDialog';
import { summaryTable, tablesOf, type Table } from './ui/tables';
import { applyEdit } from './ui/inspector';
import { openTablesDialog } from './ui/tablesDialog';
import { drawHint } from './view/hint';
import { problemEntries, focusOf, focusOfObjects, objectsOfSelection, type Focus } from './ui/problems';
import { loadFlag, saveFlag } from './project/flagStorage';
import { arrangeModules, duplicateRow, type ArrangeHow } from './layout/arrangeModules';
import { MAX_RAILS } from './layout/limits';
import { LANGUAGES, LANGUAGE_NAMES, startLanguage, t, type Language } from './i18n';
import { loadLanguage, saveLanguage } from './i18n/language';
import { TOUR_DONE_KEY } from './ui/tour';
import { TourView } from './ui/tourView';
import { canonicalJson } from './project/canonical';
import { diffProjects } from './project/diff';
import { openDiffDialog } from './ui/diffDialog';
import { describeImport, planProjectFiles, projectFileName, sniffFile } from './project/projectImport';
import { MinimapView } from './ui/minimapView';
import { overviewOf, type Overview } from './ui/overview';
import { searchProject } from './ui/search';
import { SearchView } from './ui/searchView';
import { ProblemsView } from './ui/problemsView';
import type { Finding } from './electrical/problems';
import { moduleKey, parseProjectJson, projectWarnings, type ProjectFile, type ProjectParseResult } from './project/file';
import { planModuleSwap, planModuleUpdate } from './project/sync';
import { loadCableSettings, saveCableSettings } from './project/cableSettingsStorage';
import { loadColourChoice, saveColourChoice } from './project/colourSchemeStorage';
import { loadLengthUnit, saveLengthUnit } from './project/lengthUnitStorage';
import { EXPORT_TEXT_KEY, SCREEN_TEXT_KEY, loadTextVisibility, saveTextVisibility } from './project/textVisibilityStorage';
import { makeResizable } from './ui/panelResize';
import { openExportTextDialog } from './ui/exportTextDialog';
import { SCREEN_GROUPS, buildTextOptions, setGroups } from './ui/textOptions';
import type { TextVisibility } from './view/textVisibility';
import { DEFAULT_COLOUR_CHOICE, coloursOf, type ColourChoice } from './view/colourScheme';
import { SHARE_PREFIX, decodeShare, encodeShare } from './project/share';
import { emptySchematic, removeOrphanNodes } from './schematic/model';
import { confirmDialog } from './ui/dialog';
import { InspectorView } from './ui/inspectorView';
import { copyLibrary, duplicateModule, newLibrary, removeModule, uniqueId } from './ui/libraryEditor';
import { openLibraryEditor, type EditorOptions } from './ui/libraryEditorView';
import { circuitSchedule, ferruleCounts, scheduleToCsv, wireEndLabels, wireEndLabelsToCsv, wireList, wireListToCsv } from './electrical/schedule';
import { LIGHT_THEME, setColourScheme } from './view/theme';
import { fillLabelSheet } from './ui/labelSheet';
import { MY_LIBRARY_ID, emptyMyLibrary } from './library/myModules';
import { openModuleDesigner } from './ui/moduleDesignerView';
import { embedFont, loadFonts } from './view/fontLoader';
import { MODULE_TEMPLATES } from './ui/moduleTemplates';
import { EXAMPLES } from './examples';
import { chooseExample } from './ui/examplesDialog';
import { editCableSettings } from './ui/cableSettingsDialog';
import { chooseColours } from './ui/colourDialog';
import { initMenus } from './ui/menu';
import { PaletteView } from './ui/paletteView';
import { DEFAULT_PRINT_OPTIONS, pageRule, type PrintOptions } from './project/printOptions';
import { openPrintDialog } from './ui/printDialog';
import { fillPrintSheet } from './ui/printSheet';
import { MAX_ANNOTATIONS, MAX_NOTE_CHARS, addAnnotation, hitAnnotation, moveAnnotation, removeAnnotation, setAnnotationTarget, setAnnotationText, withNotes, type Annotation } from './layout/annotations';
import { centreOf, pinchStep, type Pair } from './view/pinch';
import { ARROWS, nextModuleId, nextNodeId, nodeStep, panelStep, type Arrow } from './ui/keyboardMoves';
import { groupSelection, selectedIds, selectedNodes, selectedWires } from './ui/selection';
import { insertSnippet, makeSnippet, MAX_SNIPPETS, type Snippet } from './layout/snippets';
import { loadSnippets, planSnippetImport, saveSnippets } from './project/snippetStorage';
import { SnippetsView } from './ui/snippetsView';
import { askForText } from './ui/textDialog';
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
    const dpr = window.devicePixelRatio || 1;
    activeView().draw(ctx, stageWrap.clientWidth, stageWrap.clientHeight, dpr);
    drawHint(ctx, session.marksVisible ? emptyHint(session.project, session.mode).map(t) : [], stageWrap.clientWidth, stageWrap.clientHeight, dpr);
    drawNotePreview(ctx, dpr);
    drawMinimap();
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
  problemsView.render();
});

function resizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(stageWrap.clientWidth * dpr);
  canvas.height = Math.round(stageWrap.clientHeight * dpr);
  requestRender();
}

/** Space left around a thing that is brought to the middle of the drawing. */
const MINIMAP_KEY = 'eebox:minimap';
const FOCUS_PADDING_MM = 60;

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

/** Fingers on the canvas; two of them zoom and move the view, and the drawing is left alone meanwhile. */
const touches = new Map<number, Point>();
let pinchPair: Pair | null = null;
let pinchLocked = false;

function currentPair(): Pair | null {
  const [a, b] = [...touches.values()];
  return a && b ? { a, b } : null;
}

/* Notes written on the drawing: one is made by pressing where it points and dragging to where it goes. */
const NOTE_DRAG_MIN_PX = 6;
const NOTE_HIT_PX = 8;
let noteGesture: { from: Point; to: Point } | null = null;
let noteDrag: { id: string; part: 'head' | 'body'; last: Point } | null = null;

const NOTE_ERRORS = {
  'too-many': `A drawing can have at most ${MAX_ANNOTATIONS} notes.`,
  'bad-text': `A note is 1 to ${MAX_NOTE_CHARS} characters on one line.`,
  'unknown-note': 'That note is gone.',
  'out-of-range': 'That is too far from the drawing.',
} as const;

const noteButton = byId('note-tool');

function setNoteTool(on: boolean): void {
  session.noteTool = on;
  noteButton.classList.toggle('active', on);
  canvas.style.cursor = on ? 'crosshair' : '';
  if (!on) noteGesture = null;
  requestRender();
}

function setNotes(list: readonly Annotation[]): void {
  const { project } = session;
  session.commit(session.mode === 'panel' ? { ...project, panel: withNotes(project.panel, list) } : { ...project, schematic: withNotes(project.schematic, list) });
}

const projectNotes = (): readonly Annotation[] => (session.mode === 'panel' ? session.project.panel.annotations : session.project.schematic.annotations) ?? [];

async function finishNote(gesture: { from: Point; to: Point }): Promise<void> {
  const scale = activeView().camera.scale;
  const dragged = Math.hypot(gesture.to.x - gesture.from.x, gesture.to.y - gesture.from.y) * scale >= NOTE_DRAG_MIN_PX;
  setNoteTool(false);
  const text = await askForText('Note on the drawing', 'Text', '', 'Add');
  if (text === null) return;
  const result = addAnnotation(projectNotes(), dragged ? { at: gesture.to, target: gesture.from, text } : { at: gesture.from, text });
  if (!result.ok) return showStatus(NOTE_ERRORS[result.error], true);
  setNotes(result.list);
  session.select({ annotationId: result.id });
}

async function editNoteText(id: string): Promise<void> {
  const note = projectNotes().find((n) => n.id === id);
  if (!note) return;
  const text = await askForText('Note on the drawing', 'Text', note.text, 'Change');
  if (text === null) return;
  const result = setAnnotationText(projectNotes(), id, text);
  if (result.ok) setNotes(result.list);
  else showStatus(NOTE_ERRORS[result.error], true);
}

function removeSelectedNote(): boolean {
  const id = session.selection.annotationId;
  if (!id) return false;
  setNotes(removeAnnotation(projectNotes(), id));
  session.select({});
  return true;
}

/** The note being made, over the drawing: where the arrow points, and where the text will go. */
function drawNotePreview(context: CanvasRenderingContext2D, dpr: number): void {
  if (!noteGesture) return;
  const camera = activeView().camera;
  context.save();
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.translate(stageWrap.clientWidth / 2 - camera.x * camera.scale, stageWrap.clientHeight / 2 - camera.y * camera.scale);
  context.scale(camera.scale, camera.scale);
  context.strokeStyle = '#f5c518';
  context.fillStyle = '#f5c518';
  context.lineWidth = 2 / camera.scale;
  context.setLineDash([6 / camera.scale, 4 / camera.scale]);
  context.beginPath();
  context.moveTo(noteGesture.from.x, noteGesture.from.y);
  context.lineTo(noteGesture.to.x, noteGesture.to.y);
  context.stroke();
  context.setLineDash([]);
  context.beginPath();
  context.arc(noteGesture.from.x, noteGesture.from.y, 4 / camera.scale, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size >= 2) {
      activeView().cancel?.();
      panFrom = null;
      pinchLocked = true;
      pinchPair = currentPair();
      return;
    }
    if (pinchLocked) return;
  }
  if (e.button === 1 || (e.button === 0 && spaceHeld)) {
    panFrom = { x: e.clientX, y: e.clientY };
    return;
  }
  if (e.button !== 0) return;
  if (!(session.mode === 'panel' && session.ruler.on)) {
    const world = worldPoint(e);
    if (session.noteTool) {
      noteGesture = { from: world, to: world };
      return;
    }
    const hit = hitAnnotation(projectNotes(), world, NOTE_HIT_PX / activeView().camera.scale);
    if (hit) {
      session.select({ annotationId: hit.id });
      noteDrag = { id: hit.id, part: hit.part, last: world };
      session.annotationDraft = { mode: session.mode, list: [...projectNotes()] };
      return;
    }
  }
  if (!activeView().pointerDown(e, worldPoint(e))) panFrom = { x: e.clientX, y: e.clientY };
});

canvas.addEventListener('dblclick', (e) => {
  const hit = hitAnnotation(projectNotes(), worldPoint(e), NOTE_HIT_PX / activeView().camera.scale);
  if (hit) void editNoteText(hit.id);
});

window.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const next = currentPair();
    if (next && pinchPair) {
      const step = pinchStep(pinchPair, next);
      if (step) {
        const rect = canvas.getBoundingClientRect();
        const camera = activeView().camera;
        camera.pan(step.pan.x, step.pan.y);
        const centre = centreOf(next);
        camera.zoomAt({ x: centre.x - rect.left, y: centre.y - rect.top }, step.factor, stageWrap.clientWidth, stageWrap.clientHeight);
        pinchPair = next;
        requestRender();
      }
    }
    if (pinchLocked) return;
  }
  if (noteGesture) {
    noteGesture.to = worldPoint(e);
    requestRender();
    return;
  }
  if (noteDrag && session.annotationDraft) {
    const world = worldPoint(e);
    const [dx, dy] = [world.x - noteDrag.last.x, world.y - noteDrag.last.y];
    const { list } = session.annotationDraft;
    const note = list.find((n) => n.id === noteDrag!.id);
    const result = noteDrag.part === 'head' && note?.target ? setAnnotationTarget(list, noteDrag.id, { x: note.target.x + dx, y: note.target.y + dy }) : moveAnnotation(list, noteDrag.id, dx, dy);
    if (result.ok) {
      session.annotationDraft = { mode: session.annotationDraft.mode, list: result.list };
      noteDrag.last = world;
      requestRender();
    }
    return;
  }
  if (panFrom) {
    activeView().camera.pan(e.clientX - panFrom.x, e.clientY - panFrom.y);
    panFrom = { x: e.clientX, y: e.clientY };
    requestRender();
  }
  const world = worldPoint(e);
  activeView().pointerMove(e, world, isOverCanvas(e));
  if (isOverCanvas(e) && !session.noteTool && !(session.mode === 'panel' && session.ruler.on)) canvas.style.cursor = activeView().cursorAt?.(world) ?? '';
});

function endTouch(e: PointerEvent): boolean {
  if (e.pointerType !== 'touch') return false;
  touches.delete(e.pointerId);
  pinchPair = touches.size >= 2 ? currentPair() : null;
  const wasPinching = pinchLocked;
  // Fingers left on the screen after a pinch must not drag something along the way out.
  if (touches.size === 0) pinchLocked = false;
  return wasPinching;
}

window.addEventListener('pointerup', (e) => {
  if (endTouch(e)) return;
  if (noteGesture) {
    const gesture = noteGesture;
    noteGesture = null;
    gesture.to = worldPoint(e);
    void finishNote(gesture);
    return;
  }
  if (noteDrag) {
    const draft = session.annotationDraft;
    noteDrag = null;
    session.annotationDraft = null;
    if (draft && canonicalJson(draft.list) !== canonicalJson(projectNotes())) setNotes(draft.list);
    else session.changed();
    return;
  }
  panFrom = null;
  activeView().pointerUp(e, worldPoint(e));
});

window.addEventListener('pointercancel', (e) => {
  endTouch(e);
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    activeView().camera.zoomAt(
      { x: e.clientX - rect.left, y: e.clientY - rect.top },
      // A pinch on a trackpad arrives as a wheel with Ctrl held, and in much smaller steps than a mouse wheel.
      Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)),
      stageWrap.clientWidth,
      stageWrap.clientHeight,
    );
    requestRender();
  },
  { passive: false },
);

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
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
  } else if (mod && e.code === 'KeyA' && session.mode === 'schematic') {
    e.preventDefault();
    schematicView.selectAll();
  } else if (mod && session.mode === 'panel' && ['KeyC', 'KeyV', 'KeyD', 'KeyA'].includes(e.code)) {
    e.preventDefault();
    if (e.code === 'KeyC') panelView.copySelection();
    else if (e.code === 'KeyV') panelView.paste();
    else if (e.code === 'KeyD') panelView.duplicateSelection();
    else panelView.selectAll();
  } else if (mod && e.code === 'KeyF') {
    e.preventDefault();
    searchView.open();
  } else if (e.code === 'KeyF' && !mod) {
    e.preventDefault();
    zoomToSelection();
  } else if (e.key === '?' && !mod) {
    e.preventDefault();
    openHelpDialog(() => tourView.start());
  } else if (e.code === 'KeyR' && !mod && session.mode === 'panel') {
    session.ruler = { on: !session.ruler.on, line: null };
    session.changed();
  } else if (e.code === 'Escape' && activeView().cancel?.()) {
    e.preventDefault();
  } else if (e.code === 'Escape' && session.ruler.on) {
    session.ruler = { on: false, line: null };
    session.changed();
  } else if (e.code === 'Escape' && (session.noteTool || noteGesture)) {
    setNoteTool(false);
  } else if (e.code === 'Escape' && (hasSelection() || session.selection.annotationId) && !modalOpen()) {
    session.select({});
  } else if (!mod && ARROWS.includes(e.code) && hasSelection() && !modalOpen()) {
    e.preventDefault();
    if (session.mode === 'panel') {
      const step = panelStep(e.code as Arrow, e.altKey);
      panelView.nudgeSelection(step.rail, step.slot);
    } else {
      const step = nodeStep(e.code as Arrow, e.shiftKey);
      schematicView.nudgeSelected(step.dx, step.dy);
    }
  } else if (e.code === 'Tab' && !mod && hasSelection() && !modalOpen()) {
    // With something selected Tab walks through the drawing; Escape lets go, and Tab goes through the buttons again.
    const next = session.mode === 'panel' ? nextModuleId(session.project.panel, selectedIds(session.selection).placements, e.shiftKey) : nextNodeId(session.project.schematic, selectedNodes(session.selection), e.shiftKey);
    if (!next) return;
    e.preventDefault();
    if (session.mode === 'panel') session.select({ placementId: next });
    else schematicView.selectNodeById(next);
    requestRender();
  } else if (e.code === 'Enter' && !mod && hasSelection() && !modalOpen()) {
    byId('inspector-content').querySelector<HTMLElement>('input, select, textarea')?.focus();
  } else if (e.code === 'Delete' || e.code === 'Backspace') {
    if (!removeSelectedNote()) activeView().deleteSelection();
  }
});

const modalOpen = (): boolean => document.querySelector('dialog[open]') !== null;

/** Something the arrow keys, Tab and Enter act on: a module or comb on the panel, a node on the schematic. */
function hasSelection(): boolean {
  return session.mode === 'panel' ? selectedIds(session.selection).placements.length + selectedIds(session.selection).combs.length > 0 : selectedNodes(session.selection).length > 0;
}

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
  void keepSnapshot(true);
  currentProjectId = null;
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
  return confirmDialog('Discard the current panel and schematic? Its last state stays under File > Projects, in Earlier states.', 'Discard');
}

function describeErrors(source: string, errors: ValidationError[]): string[] {
  const shown = errors.slice(0, 5).map((err) => `${source} ${err.path || '(root)'}: ${err.message}`);
  const hidden = errors.length - shown.length;
  return hidden > 0 ? [...shown, `${source}: ${hidden} more errors`] : shown;
}

function applyLoaded(file: ProjectFile, warnings: string[], source: string): void {
  void keepSnapshot(true);
  currentProjectId = null;
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

const projectStore: ProjectStore = typeof indexedDB === 'undefined' ? new MemoryProjectStore() : new IndexedDbProjectStore();
/** The stored project that the one on the screen was opened from or saved as, until another is loaded. */
let currentProjectId: string | null = null;

async function saveProjectHere(asNew: boolean): Promise<void> {
  const stored = await projectStore.list();
  const id = !asNew && currentProjectId && stored.some((p) => p.id === currentProjectId) ? currentProjectId : newProjectId(stored);
  const file = session.toFile();
  await projectStore.put({ id, title: session.project.panel.title ?? '', savedAt: Date.now(), file });
  currentProjectId = id;
  showStatus(`Saved in this browser as "${session.project.panel.title || 'Untitled panel'}".`);
}

function showDifferences(file: ProjectFile, name: string): void {
  openDiffDialog(`"${name}" compared with the project on the screen`, name, diffProjects(session.toFile(), file));
}

byId<HTMLInputElement>('compare-file').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const text = await file.text();
  input.value = '';
  const result = parseProjectJson(text);
  if (!result.ok) return showStatus(describeErrors(file.name, result.errors).join('\n'), true);
  showDifferences(result.file, file.name);
});

async function openProjectsList(): Promise<void> {
  await openProjectsDialog({
    list: () => projectStore.list(),
    currentId: () => currentProjectId,
    saveCurrent: () => saveProjectHere(false),
    saveAsNew: () => saveProjectHere(true),
    open: async (project) => {
      const result = parseProjectJson(JSON.stringify(project.file));
      if (!result.ok) return showStatus(describeErrors(project.title || 'The stored project', result.errors).join('\n'), true);
      if (!(await confirmDiscard())) return;
      applyLoaded(result.file, result.warnings, project.title || 'Untitled panel');
      currentProjectId = project.id;
    },
    compare: (project) => showDifferences(project.file, project.title || 'Untitled panel'),
    export: (project) => downloadBlob(new Blob([JSON.stringify(project.file, null, 2)], { type: 'application/json' }), projectFileName(project.title)),
    importFiles: async (files) => {
      const texts = await Promise.all(files.map(async (file) => ({ name: file.name, text: await file.text() })));
      const plan = planProjectFiles(await projectStore.list(), texts, Date.now());
      for (const project of plan.put) await projectStore.put(project);
      return describeImport(plan.results);
    },
    remove: async (project) => {
      if (!(await confirmDialog(`Delete "${project.title || 'Untitled panel'}" from this browser?`, 'Delete'))) return false;
      await projectStore.remove(project.id);
      if (currentProjectId === project.id) currentProjectId = null;
      return true;
    },
  });
}

let lastSnapshotJson = '';
let lastSnapshotAt = 0;

/** Keeps the project on the screen as an earlier state; a failure here must never get in the way of the work. */
async function keepSnapshot(force: boolean): Promise<void> {
  if (!hasWork(session.project)) return;
  const file = session.toFile();
  const json = canonicalJson(file);
  const now = Date.now();
  if (json === lastSnapshotJson || (!force && now - lastSnapshotAt < SNAPSHOT_INTERVAL_MS)) return;
  try {
    const all = await projectStore.list();
    lastSnapshotJson = json;
    if (all.some((p) => canonicalJson(p.file) === json)) return;
    const snapshot = { id: newSnapshotId(all, now), title: file.project.panel.title ?? '', savedAt: now, file, snapshot: true as const };
    await projectStore.put(snapshot);
    lastSnapshotAt = now;
    for (const old of snapshotsToDrop([...all, snapshot])) await projectStore.remove(old.id);
  } catch {
    lastSnapshotJson = '';
  }
}

async function backupEverything(): Promise<void> {
  try {
    const settings: Record<string, string> = {};
    for (const key of SETTING_KEYS) {
      const value = autosaveStore?.getItem(key);
      if (value !== null && value !== undefined) settings[key] = value;
    }
    const workspace = buildWorkspace({
      savedAt: Date.now(),
      current: session.toFile(),
      projects: savedProjects(await projectStore.list()),
      libraries: (await storage.list()).filter((library) => library.id !== bundledLibraryId),
      snippets,
      settings,
    });
    downloadBlob(new Blob([workspaceToText(workspace)], { type: 'application/json' }), `eebox-backup-${new Date().toISOString().slice(0, 10)}.json`);
    showStatus(`Backed up ${workspace.projects.length} project${workspace.projects.length === 1 ? '' : 's'}, ${workspace.libraries.length} librar${workspace.libraries.length === 1 ? 'y' : 'ies'} and the project on the screen.`);
  } catch (error) {
    showStatus(`Backup failed: ${(error as Error).message}`, true);
  }
}

async function restoreEverything(text: string, name: string): Promise<void> {
  const parsed = parseWorkspace(text);
  if (!parsed.ok) return showStatus(describeErrors(name, parsed.errors).join('\n'), true);
  const { workspace } = parsed;
  try {
    const plan = planProjectImport(await projectStore.list(), savedProjects(workspace.projects));
    const libraries = workspace.libraries.filter((library) => library.id !== bundledLibraryId);
    const settings = Object.keys(workspace.settings).length;
    const snippetPlan = planSnippetImport(snippets, workspace.snippets);
    const lines = [
      `${plan.added} project${plan.added === 1 ? '' : 's'} added${plan.unchanged > 0 ? ` (${plan.unchanged} already here)` : ''}`,
      `${libraries.length} librar${libraries.length === 1 ? 'y' : 'ies'} put in, replacing any with the same id`,
      `${snippetPlan.added} snippet${snippetPlan.added === 1 ? '' : 's'} added${snippetPlan.skipped > 0 ? ` (${snippetPlan.skipped} left out: the limit)` : ''}`,
      `${settings} setting${settings === 1 ? '' : 's'} replaced`,
      ...(workspace.current ? ['the project on the screen replaced; it is kept under Earlier states'] : []),
    ];
    if (!(await confirmDialog(`Restore ${name}?\n\n${lines.join('\n')}.`, 'Restore'))) return;
    for (const project of plan.put) await projectStore.put(project);
    for (const library of libraries) await storage.put(library);
    await refreshLibraries();
    if (snippetPlan.added > 0) setSnippets([...snippets, ...snippetPlan.put]);
    if (autosaveStore) {
      for (const [key, value] of Object.entries(workspace.settings)) autosaveStore.setItem(key, value);
      applyStoredSettings(autosaveStore);
    }
    if (workspace.current) applyLoaded(workspace.current, parsed.warnings, name);
    else showStatus(`Restored ${name}.`);
  } catch (error) {
    showStatus(`Restore failed: ${(error as Error).message}`, true);
  }
}

byId('backup-all').addEventListener('click', () => void backupEverything());

let snippets: Snippet[] = [];
const snippetsView = new SnippetsView(byId('snippets'), {
  onSaveSelection: () => void saveSelectionAsSnippet(),
  onInsert: (snippet) => insertSnippetHere(snippet),
  onRemove: (snippet) => void removeSnippet(snippet),
});
snippetsView.render(snippets);

function setSnippets(next: Snippet[]): void {
  snippets = next;
  snippetsView.render(snippets);
  if (autosaveStore && !saveSnippets(autosaveStore, snippets)) showStatus('Snippets are used now but could not be stored.', true);
}

const SNIPPET_ERRORS = {
  empty: 'Select the modules to keep first: Shift-click or drag a rubber band over them.',
  'bad-name': 'A snippet needs a name of 1 to 60 characters.',
  'too-many': `There can be at most ${MAX_SNIPPETS} snippets; take one away first.`,
} as const;

async function saveSelectionAsSnippet(): Promise<void> {
  const { placements, combs } = selectedIds(session.selection);
  if (placements.length + combs.length === 0) return showStatus(SNIPPET_ERRORS.empty, true);
  const name = await askForText('Save as a snippet', 'Name', '', 'Save');
  if (name === null) return;
  const result = makeSnippet(session.project, session.resolve, { placementIds: placements, combIds: combs }, name, Date.now(), snippets);
  if (!result.ok) return showStatus(SNIPPET_ERRORS[result.error], true);
  setSnippets([...snippets, result.snippet]);
  showStatus(`Snippet "${result.snippet.name}" saved.`);
}

function insertSnippetHere(snippet: Snippet): void {
  const { placements } = selectedIds(session.selection);
  const rail = session.project.panel.placements.find((p) => placements.includes(p.id))?.rail ?? 0;
  const result = insertSnippet(session.project, session.snapshot, session.resolve, snippet, { rail, slot: 0 });
  if (!result.ok) return showStatus('There is no room on the rails for this snippet.', true);
  session.commit(result.project, result.snapshot);
  session.select(groupSelection(result.placementIds, result.combIds));
  showStatus(`Snippet "${snippet.name}" put on the panel.`);
}

async function removeSnippet(snippet: Snippet): Promise<void> {
  if (await confirmDialog(`Take the snippet "${snippet.name}" away?`, 'Take away')) setSnippets(snippets.filter((s) => s.id !== snippet.id));
}
byId<HTMLInputElement>('restore-all').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const text = await file.text();
  input.value = '';
  await restoreEverything(text, file.name);
});

const problemsView = new ProblemsView(
  byId('problems'),
  () => problemEntries(session.findings, projectWarnings(session.project, session.resolve, session.cableSettings)),
  (finding) => showFinding(finding),
);

/** Takes the view to what a finding is about, selects it and puts it in the middle of the drawing. */
/** The largest zoom a jump to a small thing ends at, so a single module is shown among its neighbours. */
const MAX_FOCUS_SCALE = 2;

/** Takes the view to what a focus is about and selects it; `zoomIn` also zooms to fill the stage with it. */
function showFocus(focus: Focus, zoomIn: boolean): void {
  if (focus.mode !== session.mode) setMode(focus.mode);
  const view = views[focus.mode];
  const pad = FOCUS_PADDING_MM;
  const box = { minX: focus.bounds.minX - pad, minY: focus.bounds.minY - pad, maxX: focus.bounds.maxX + pad, maxY: focus.bounds.maxY + pad };
  const visibleWidth = stageWrap.clientWidth / view.camera.scale;
  const visibleHeight = stageWrap.clientHeight / view.camera.scale;
  const bigger = box.maxX - box.minX > visibleWidth * 0.9 || box.maxY - box.minY > visibleHeight * 0.9;
  if (zoomIn || bigger) {
    view.camera.fit(box, stageWrap.clientWidth, stageWrap.clientHeight, 0);
    if (view.camera.scale > MAX_FOCUS_SCALE) view.camera.scale = MAX_FOCUS_SCALE;
  } else {
    view.camera.x = (box.minX + box.maxX) / 2;
    view.camera.y = (box.minY + box.maxY) / 2;
  }
  session.select(focus.selection);
}

function showFinding(finding: Finding): void {
  const focus = focusOf(session.project, session.resolve, finding, session.mode);
  if (!focus) return showStatus('That is no longer on the drawing.', true);
  showFocus(focus, false);
}

/** Zooms to what is selected in this view; with nothing selected here it shows the whole drawing. */
function zoomToSelection(): void {
  const focus = focusOfObjects(session.project, session.resolve, objectsOfSelection(session.selection), session.mode);
  if (!focus || focus.mode !== session.mode) return fitView();
  const keep = session.selection;
  showFocus(focus, true);
  session.select(keep);
}

const tourView = new TourView(
  byId('tour'),
  (step) => {
    if (step.mode !== session.mode) setMode(step.mode);
  },
  () => {
    if (autosaveStore) saveFlag(autosaveStore, TOUR_DONE_KEY, true);
  },
);

const searchView = new SearchView(
  byId('search'),
  (query) => searchProject(session.project, session.resolve, query),
  (result) => {
    const focus = focusOfObjects(session.project, session.resolve, result.objects, result.prefer);
    if (!focus) return showStatus('That is no longer on the drawing.', true);
    showFocus(focus, true);
  },
);

const minimap = new MinimapView(byId<HTMLCanvasElement>('minimap'), () => activeView().camera, () => requestRender());
let overviewCache: { key: unknown[]; value: Overview } | null = null;

function drawMinimap(): void {
  if (!minimap.visible) return;
  const key = [session.project, session.mode, session.libraries, session.snapshot];
  if (!overviewCache || overviewCache.key.some((part, i) => part !== key[i])) overviewCache = { key, value: overviewOf(session.project, session.resolve, session.mode) };
  minimap.draw(overviewCache.value, activeView().camera, stageWrap.clientWidth, stageWrap.clientHeight);
}

function checkProject(): void {
  problemsView.toggle();
  if (!problemsView.visible) return;
  const found = problemEntries(session.findings, projectWarnings(session.project, session.resolve, session.cableSettings));
  showStatus(found.length === 0 ? 'Check passed: no problems found.' : '');
}

let printOptions: PrintOptions = DEFAULT_PRINT_OPTIONS;

async function printProject(): Promise<void> {
  const chosen = await openPrintDialog(printOptions);
  if (!chosen) return;
  printOptions = chosen;
  const sheet = byId('print-sheet');
  const pageStyle = document.createElement('style');
  pageStyle.textContent = `@media print { ${pageRule(chosen)} }`;
  document.head.append(pageStyle);
  fillPrintSheet(sheet, session, views, chosen);
  window.addEventListener('afterprint', () => {
    sheet.replaceChildren();
    pageStyle.remove();
  }, { once: true });
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
  downloadBlob(new Blob([embedFont(renderToSvg(activeView(), session, LIGHT_THEME))], { type: 'image/svg+xml' }), `${stem}-${session.mode}.svg`);
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

/**
 * Brings the project up to date with a module that was just saved, so a design shows on the panel at
 * once: the placed module a bundled device was designed from is given the design, and the copy of a
 * module that the project stored is replaced. Wires that would be lost are asked about first.
 */
async function useDesigned(library: Library, moduleId: string, placementId: string | undefined): Promise<void> {
  const def = library.modules.find((m) => m.id === moduleId);
  if (!def) return;
  const ref = { libraryId: library.id, moduleId };
  const key = moduleKey(ref);
  const placement = placementId === undefined ? undefined : session.project.panel.placements.find((p) => p.id === placementId);
  const swap = placement !== undefined && moduleKey(placement.module) !== key;
  const onlyThis = (r: ModuleRef) => (moduleKey(r) === key ? session.libraryResolve(r) : (session.snapshot[moduleKey(r)] ?? session.libraryResolve(r)));
  const plan = swap ? planModuleSwap(session.project, session.snapshot, placement.id, ref, def, session.resolve) : planModuleUpdate(session.project, session.snapshot, onlyThis);
  if (!swap && plan.changed.length === 0) return;
  const effects = [
    plan.droppedWires > 0 ? `removes ${plan.droppedWires} wire${plan.droppedWires === 1 ? '' : 's'} from terminals that no longer exist` : '',
    plan.newProblems.length > 0 ? `causes ${plan.newProblems.length} problem${plan.newProblems.length === 1 ? '' : 's'}: ${plan.newProblems.slice(0, 3).join('; ')}` : '',
  ].filter(Boolean);
  if (effects.length > 0 && !(await confirmDialog(`Using "${def.name}" on the panel ${effects.join(' and ')}. Continue?`, 'Continue'))) {
    showStatus(`"${def.name}" is saved in ${library.name}; the panel still has the previous definition.`);
    return;
  }
  session.commit(plan.project, plan.snapshot);
  showStatus(swap ? `The module on the panel now uses "${def.name}" from ${library.name}.` : `The panel has the new "${def.name}".`);
}

function openDesigner(library: Library, moduleId: string, options: { isNew: boolean; offerTemplates?: boolean; placementId?: string }): void {
  const { placementId, ...designer } = options;
  openModuleDesigner(library, { moduleId, ...designer }, {
    save: async (saved) => {
      await storage.put(saved);
      await refreshLibraries();
      await useDesigned(saved, moduleId, placementId);
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

function designCopyOf(def: ModuleDef, placementId?: string): void {
  const draft = myLibraryDraft();
  const id = uniqueId(`${def.id}-copy`, draft.modules.map((m) => m.id));
  draft.modules.push({ ...structuredClone(def), id, name: `${def.name} (copy)` });
  openDesigner(draft, id, { isNew: true, ...(placementId ? { placementId } : {}) });
}

/** A module of a library the user owns is edited in place; one of the bundled library is copied first. */
function designModuleOf(ref: ModuleRef, placementId?: string): void {
  const library = session.libraries.find((l) => l.id === ref.libraryId);
  const stored = library?.modules.find((m) => m.id === ref.moduleId);
  if (library && stored && library.id !== bundledLibraryId) return openDesigner(structuredClone(library), stored.id, { isNew: false, ...(placementId ? { placementId } : {}) });
  const def = session.resolve(ref);
  if (def) designCopyOf(def, placementId);
  else showStatus('That module is not in any library, so it cannot be edited.', true);
}

async function duplicateModuleOf(library: Library, def: ModuleDef): Promise<void> {
  const copy = duplicateModule(structuredClone(library), def.id);
  if (!copy) return showStatus('That module is not in the library any more.', true);
  await storage.put(copy.draft);
  await refreshLibraries();
  showStatus(`Made "${def.name} (copy)" next to it in ${library.name}.`);
}

async function deleteModuleOf(library: Library, def: ModuleDef): Promise<void> {
  const used = session.project.panel.placements.some((p) => moduleKey(p.module) === moduleKey({ libraryId: library.id, moduleId: def.id }));
  const next = removeModule(structuredClone(library), def.id);
  if (!next) return showStatus('That module is not in the library any more.', true);
  const note = used ? ' The panel uses it and keeps its own copy of its definition.' : '';
  if (!(await confirmDialog(`Take "${def.name}" out of ${library.name}?${note}`, 'Take out'))) return;
  await storage.put(next);
  await refreshLibraries();
  showStatus(`Took "${def.name}" out of ${library.name}.`);
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

async function openProjectFile(text: string, name: string): Promise<string | null> {
  const result = parseProjectJson(text);
  if (!result.ok) return describeErrors(name, result.errors).join('\n');
  if (await confirmDiscard()) applyLoaded(result.file, result.warnings, name);
  return null;
}

async function importFiles(files: FileList | File[]): Promise<void> {
  const lines: string[] = [];
  let failed = false;
  for (const file of files) {
    const source = await file.text();
    const kind = sniffFile(source);
    if (kind === 'project' || kind === 'workspace') {
      const problem = kind === 'project' ? await openProjectFile(source, file.name) : (await restoreEverything(source, file.name), null);
      if (problem) {
        failed = true;
        lines.push(problem);
      }
      continue;
    }
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
  onDuplicateModule: (library, def) => void duplicateModuleOf(library, def),
  onDeleteModule: (library, def) => void deleteModuleOf(library, def),
  onCopy: (library) => {
    const id = uniqueId(`my-${library.id}`, session.libraries.map((l) => l.id));
    openEditor(copyLibrary(library, id, `My ${library.name}`), { isNew: true, originalId: null });
  },
  isBundled: (library) => library.id === bundledLibraryId,
});

new ShelfView(byId('shelf'), session, (e, item) => panelView.startShelfDrag(e, item, worldPoint(e)));

const inspector = new InspectorView(byId('inspector-content'), session, (message) => confirmDialog(message, 'Continue'), designModuleOf, (unit) => autosaveStore && saveLengthUnit(autosaveStore, unit));

// Commit a typed value before a click elsewhere changes the selection under it.
window.addEventListener(
  'pointerdown',
  () => {
    const active = document.activeElement;
    if ((active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && inspector.owns(active)) active.blur();
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
byId('print').addEventListener('click', () => void printProject());
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
byId('zoom-selection').addEventListener('click', zoomToSelection);
noteButton.addEventListener('click', () => setNoteTool(!session.noteTool));
byId('feed-from-first').addEventListener('click', () => schematicView.feedFromFirst());
byId('chain-selected').addEventListener('click', () => schematicView.chainSelected());

const ARRANGE_MESSAGES = {
  'nothing-to-do': 'Select the modules to line up first, or they already stand so.',
  'too-few': 'Spreading needs three or more selected modules on a rail.',
  blocked: 'That would put a module on another one that is not selected.',
} as const;

function arrangeSelected(how: ArrangeHow): void {
  const { placements } = selectedIds(session.selection);
  const result = arrangeModules(session.project.panel, session.widthOf, placements, how);
  if (!result.ok) return showStatus(ARRANGE_MESSAGES[result.error], true);
  session.commit({ ...session.project, panel: result.panel });
}

for (const [id, how] of [['pack-left', 'pack-left'], ['pack-right', 'pack-right'], ['spread-modules', 'spread'], ['row-start', 'row-start'], ['row-end', 'row-end']] as const) {
  byId(id).addEventListener('click', () => arrangeSelected(how));
}

byId('duplicate-row').addEventListener('click', () => {
  const { selection, project } = session;
  const rail = selection.rail ?? project.panel.placements.find((p) => p.id === (selection.placementId ?? selection.placementIds?.[0]))?.rail;
  if (rail === undefined) return showStatus('Select a row first: click its rail, or a module on it.', true);
  const result = duplicateRow(project.panel, rail);
  if (!result.ok) return showStatus(result.error === 'invalid-value' ? `A panel has at most ${MAX_RAILS} rows.` : 'That row cannot be copied.', true);
  session.commit({ ...project, panel: result.panel });
  showStatus(`Row ${rail + 1} copied. Nodes > Sync modules puts the copies on the schematic.`);
});
byId('find').addEventListener('click', () => searchView.open());
byId<HTMLInputElement>('view-minimap').addEventListener('change', (e) => {
  const shown = (e.target as HTMLInputElement).checked;
  minimap.visible = shown;
  if (autosaveStore) saveFlag(autosaveStore, MINIMAP_KEY, shown);
  requestRender();
});
byId('ruler').addEventListener('click', () => {
  session.ruler = { on: !session.ruler.on, line: null };
  session.changed();
});
byId('save-project').addEventListener('click', () =>
  downloadBlob(new Blob([JSON.stringify(session.toFile(), null, 2)], { type: 'application/json' }), projectFileName(session.project.panel.title)),
);
byId('share-link').addEventListener('click', () => void shareLink());
byId('export-png').addEventListener('click', () => void exportPng());
byId('export-svg').addEventListener('click', exportSvg);
byId('export-bom').addEventListener('click', exportBom);
byId('export-circuits').addEventListener('click', exportCircuits);
byId('export-wires').addEventListener('click', exportWires);
byId('export-wire-labels').addEventListener('click', exportWireLabels);
for (const preset of ['source1', 'source3', 'sourcePen1', 'sourcePen', 'load1', 'load3', 'earthElectrode'] as const) {
  byId(`add-${preset}`).addEventListener('click', () => {
    schematicView.addFreeNode(preset);
    fitView('schematic');
  });
}
byId('check').addEventListener('click', checkProject);
byId('help').addEventListener('click', () => openHelpDialog(() => tourView.start()));
byId('open-projects').addEventListener('click', () => void openProjectsList());
byId('export-text').addEventListener('click', async () => {
  const chosen = await openExportTextDialog(session.exportTexts);
  if (!chosen) return;
  session.exportTexts = chosen;
  if (autosaveStore) saveTextVisibility(autosaveStore, EXPORT_TEXT_KEY, chosen);
});

function setScreenTexts(texts: TextVisibility): void {
  session.texts = texts;
  if (autosaveStore) saveTextVisibility(autosaveStore, SCREEN_TEXT_KEY, texts);
  buildTextOptions(byId('view-text-options'), SCREEN_GROUPS, texts, setScreenTexts);
  session.changed();
}
byId('show-all-text').addEventListener('click', () => setScreenTexts(setGroups(session.texts, SCREEN_GROUPS, true)));
byId('hide-all-text').addEventListener('click', () => setScreenTexts(setGroups(session.texts, SCREEN_GROUPS, false)));
buildTextOptions(byId('view-text-options'), SCREEN_GROUPS, session.texts, setScreenTexts);
const currentTables = () => tablesOf(session.project, session.resolve, session.cableSettings);

/** A typed value in a cell is an edit in the inspector of the object the row stands for. */
function editTableCell(table: Table, row: number, column: number, raw: string): string | null {
  const selection = table.selections?.[row];
  const key = table.columns[column]?.edit;
  if (!selection || !key) return 'That cell cannot be edited.';
  const result = applyEdit(
    {
      project: session.project,
      selection,
      mode: 'schematic',
      resolve: session.resolve,
      snapshot: session.snapshot,
      fromLibraries: session.libraryResolve,
      cableSettings: session.cableSettings,
      findings: session.findings,
      lengthUnit: session.lengthUnit,
    },
    key,
    raw,
  );
  if (!result.ok) return result.message || 'That value is not accepted.';
  session.commit(result.project, result.snapshot);
  return null;
}

byId('view-checks').addEventListener('click', () => {
  const checks = () => [summaryTable(session.project, session.resolve, session.cableSettings)];
  openTablesDialog(checks(), { edit: () => 'That cell cannot be edited.', tables: checks }, 'Calculation summary');
});
byId('view-tables').addEventListener('click', () => openTablesDialog(currentTables(), { edit: editTableCell, tables: currentTables }));
byId('arrange-nodes').addEventListener('click', () => {
  schematicView.arrangeAll();
  fitView('schematic');
});
for (const how of ['left', 'centre', 'right', 'top', 'middle', 'bottom'] as const) byId(`align-${how}`).addEventListener('click', () => schematicView.alignSelected(how));
byId('distribute-horizontally').addEventListener('click', () => schematicView.distributeSelected('horizontal'));
byId('distribute-vertically').addEventListener('click', () => schematicView.distributeSelected('vertical'));
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
const NARROW_PX = 1000;

const chosenHidden: Partial<Record<keyof typeof PANEL_KEYS, boolean>> = {};

/** Below this width the panels are drawers over the drawing, closed until asked for; nothing is kept of how they were left. */
const NARROW_QUERY = `(max-width: ${NARROW_PX - 1}px)`;
const narrowWindow = window.matchMedia(NARROW_QUERY);
const drawerOpen: Record<keyof typeof PANEL_KEYS, boolean> = { sidebar: false, inspector: false };

function panelHidden(name: keyof typeof PANEL_KEYS): boolean {
  if (narrowWindow.matches) return !drawerOpen[name];
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
  document.body.classList.toggle('narrow', narrowWindow.matches);
  for (const name of ['sidebar', 'inspector'] as const) {
    document.body.classList.toggle(`hide-${name}`, panelHidden(name));
    byId(`toggle-${name}`).classList.toggle('active', !panelHidden(name));
  }
}

for (const name of ['sidebar', 'inspector'] as const) {
  byId(`toggle-${name}`).addEventListener('click', () => {
    if (narrowWindow.matches) {
      const open = !drawerOpen[name];
      drawerOpen.sidebar = drawerOpen.inspector = false;
      drawerOpen[name] = open;
      showPanels();
      return;
    }
    chosenHidden[name] = !panelHidden(name);
    try {
      window.localStorage.setItem(PANEL_KEYS[name], chosenHidden[name] ? 'yes' : 'no');
    } catch {
      // The choice then holds for this visit only.
    }
    showPanels();
  });
}
narrowWindow.addEventListener('change', () => {
  drawerOpen.sidebar = drawerOpen.inspector = false;
  showPanels();
});
showPanels();

const widthOf = (name: 'sidebar' | 'inspector') => (document.body.classList.contains(`hide-${name}`) || (name === 'sidebar' && session.mode === 'schematic') ? 0 : byId(name).getBoundingClientRect().width);
makeResizable({ handle: byId('sidebar-resizer'), panel: byId('sidebar'), side: 'left', cssVariable: '--sidebar-width', storageKey: 'eebox:width-sidebar', defaultPx: 240, otherWidth: () => widthOf('inspector') });
makeResizable({ handle: byId('inspector-resizer'), panel: byId('inspector'), side: 'right', cssVariable: '--inspector-width', storageKey: 'eebox:width-inspector', defaultPx: 270, otherWidth: () => widthOf('sidebar') });

const autosaveStore: KeyValueStore | null = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
const AUTOSAVE_DELAY_MS = 500;

/** Only started after the initial project is restored, so the empty startup state cannot overwrite a saved one. */
const tabGuard = new TabGuard();

function startAutosave(store: KeyValueStore): void {
  let lastSaved: object | null = null;
  let timer: number | undefined;
  const save = () => {
    lastSaved = session.revision;
    const file = session.toFile();
    tabGuard.wrote(serializeAutosave(file));
    if (!saveAutosave(store, file)) showStatus('Autosave failed: browser storage is unavailable or full.', true);
    void keepSnapshot(false);
  };
  session.subscribe(() => {
    if (session.revision === lastSaved) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (tabGuard.conflict) return;
      save();
    }, AUTOSAVE_DELAY_MS);
  });
  window.addEventListener('storage', (e) => {
    if (tabGuard.seen(e.key, e.newValue)) showConflict(store, save);
  });
}

/** Another tab wrote the autosave: say so, and let the person choose which version stands. */
function showConflict(store: KeyValueStore, save: () => void): void {
  const banner = byId('conflict');
  const note = Object.assign(document.createElement('p'), { textContent: 'This project was changed in another tab of this browser. Until you choose, this tab does not save, so that neither version is overwritten.' });
  const done = () => {
    tabGuard.resolve();
    banner.hidden = true;
  };
  const keep = Object.assign(document.createElement('button'), { textContent: 'Keep this tab\'s version' });
  keep.addEventListener('click', () => {
    done();
    save();
  });
  const load = Object.assign(document.createElement('button'), { textContent: 'Load the other tab\'s version', className: 'primary' });
  load.addEventListener('click', () => {
    const other = loadAutosave(store);
    done();
    if (other?.ok) {
      applyLoaded(other.file, other.warnings, 'The other tab');
      tabGuard.wrote(store.getItem(AUTOSAVE_KEY));
    } else showStatus('The other tab\'s version could not be read; this tab keeps its own.', true);
  });
  const actions = Object.assign(document.createElement('div'), { className: 'tour-actions' });
  actions.append(keep, load);
  banner.replaceChildren(note, actions);
  banner.hidden = false;
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

/** Takes the settings kept in the browser into use; also after a backup has put new ones there. */
function applyStoredSettings(store: KeyValueStore): void {
  const { settings, problem } = loadCableSettings(store);
  session.cableSettings = settings;
  if (problem) showStatus(problem, true);
  session.lengthUnit = loadLengthUnit(store);
  session.exportTexts = loadTextVisibility(store, EXPORT_TEXT_KEY);
  session.texts = loadTextVisibility(store, SCREEN_TEXT_KEY);
  buildTextOptions(byId('view-text-options'), SCREEN_GROUPS, session.texts, setScreenTexts);
  const stored = loadSnippets(store);
  snippets = stored.snippets;
  snippetsView.render(snippets);
  if (stored.problem) showStatus(stored.problem, true);
  const minimapShown = loadFlag(store, MINIMAP_KEY, true);
  minimap.visible = minimapShown;
  byId<HTMLInputElement>('view-minimap').checked = minimapShown;
  const colours = loadColourChoice(store);
  colourChoice = colours.choice;
  setColourScheme(coloursOf(colours.choice));
  if (colours.problem) showStatus(colours.problem, true);
  session.changed();
}

async function init(): Promise<void> {
  const stored = autosaveStore ? loadAutosave(autosaveStore) : null;
  if (autosaveStore) applyStoredSettings(autosaveStore);
  try {
    await seedBundledLibrary(storage, genericIecText);
    await refreshLibraries();
  } catch (error) {
    showStatus(`Library storage failed: ${(error as Error).message}`, true);
  }
  resizeCanvas();
  const fontProblem = await loadFonts();
  if (fontProblem) showStatus(fontProblem, true);
  await restoreInitialProject(stored);
  if (autosaveStore && !loadFlag(autosaveStore, TOUR_DONE_KEY, false) && !hasWork(session.project)) tourView.start();
  if (autosaveStore) startAutosave(autosaveStore);
}

/** The language of the page: what was chosen, else what the browser asks for. Changing it reloads the page, which keeps its project. */
function setUpLanguage(): void {
  const language = loadLanguage(autosaveStore, navigator.languages);
  startLanguage(language);
  const select = byId<HTMLSelectElement>('language');
  select.replaceChildren(...LANGUAGES.map((code) => Object.assign(new Option(LANGUAGE_NAMES[code], code), { selected: code === language })));
  select.addEventListener('change', () => {
    if (autosaveStore) saveLanguage(autosaveStore, select.value as Language);
    // The autosave waits a moment after a change; the page is reloaded after it.
    window.setTimeout(() => location.reload(), AUTOSAVE_DELAY_MS + 100);
  });
}

setUpLanguage();
void init();
