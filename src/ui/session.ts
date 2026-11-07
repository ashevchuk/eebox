import { DEFAULT_CABLE_SETTINGS, type CableSettings } from '../electrical/cables';
import { lookupsOf } from '../layout/lookups';
import { ductsOf } from '../layout/ducts';
import { notesOnPlate, plateById, plateOfSelection, scopeToPlate, type PlateScope } from '../layout/plates';
import { createPanel } from '../layout/panel';
import type { ModuleRef } from '../layout/placement';
import type { Library, ModuleDef } from '../library/types';
import type { Project } from '../project';
import { buildProjectFile, moduleKey, type ProjectFile } from '../project/file';
import { emptySchematic } from '../schematic/model';
import { findFindings, type Finding } from '../electrical/problems';
import { findDuctFillFindings } from '../electrical/ductFill';
import { findPlacementFindings } from '../layout/placementFindings';
import { groupSelection, selectedIds, selectedWires, wireGroupSelection } from './selection';
import type { RulerLine } from '../view/ruler';
import { History } from '../view/history';
import type { Annotation } from '../layout/annotations';
import type { LengthUnit } from '../project/lengthUnitStorage';
import { ALL_TEXT, type TextVisibility } from '../view/textVisibility';

export type Mode = 'panel' | 'schematic';

export interface Selection {
  placementId?: string;
  nodeId?: string;
  /** Set instead of `nodeId` when several nodes of the schematic are selected together. */
  nodeIds?: string[];
  wireId?: string;
  /** Set instead of `wireId` when several wires are selected together. */
  wireIds?: string[];
  combId?: string;
  /** A cable duct on the panel. */
  ductId?: string;
  /** Set instead of `ductId` when several items, ducts among them, are selected together. */
  ductIds?: string[];
  /** A note written on the drawing of the view that is on. */
  annotationId?: string;
  /** Set instead of `placementId` and `combId` when several items are selected together. */
  placementIds?: string[];
  combIds?: string[];
  /** Index of the selected row (rail). */
  rail?: number;
}

export const emptyProject = (): Project => ({
  panel: createPanel([]),
  schematic: emptySchematic(),
});

/** One step of history: the project and the definitions of the modules it was drawn with. */
interface Document {
  project: Project;
  /** Module definitions stored with the project; they win over libraries so a design stays reproducible. */
  snapshot: Record<string, ModuleDef>;
}

/** State shared by the panel and schematic views. */
export class Session {
  libraries: Library[] = [];
  /** The cable table and voltage drop norms; the user can replace them. */
  cableSettings: CableSettings = DEFAULT_CABLE_SETTINGS;
  /** How the inspector shows and takes positions and widths; the project keeps module units. */
  lengthUnit: LengthUnit = 'units';
  /** The kinds of text the drawings show on the screen. */
  texts: TextVisibility = ALL_TEXT;
  /** The kinds of text that PNG, SVG and print show, whatever the screen shows. */
  exportTexts: TextVisibility = ALL_TEXT;
  mode: Mode = 'panel';
  /** Whether the panel shows the distances from the selected thing to its neighbours. */
  dimensionsShown = true;
  /** The grid, in mm, that devices dragged on a plate are drawn to; 0 for none. */
  gridMm = 0;
  /** The tool that draws a cable duct on the panel is on: the next press and drag makes one. */
  ductTool = false;
  /** The tool that puts a note on the drawing is on: the next press and drag on the drawing writes one. */
  noteTool = false;
  /** The notes of the view that is on while one is being dragged, before the drag is committed. */
  annotationDraft: { mode: Mode; list: Annotation[] } | null = null;
  selection: Selection = {};
  private plateChosen = '';
  private scopeCache: { panel: object; plate: string; scope: PlateScope } | null = null;
  /** Whether the drawings mark the faults and the advice; off while exporting, so a drawing for others is not full of red. */
  marksVisible = true;
  /** Whether the list of what Check found is open: the drawings mark the findings only then, and the one that was picked in the list. */
  checkOpen = false;
  private focusedMessage: string | null = null;
  private findingCache: { revision: object; libraries: Library[]; settings: CableSettings; list: Finding[] } | null = null;
  /** Draw only the rails and what stands on them, without the frame; set while the full-size print is made. */
  bareDrawing = false;
  /** The wire under the pointer in the schematic, highlighted on the screen; it is left out of exports. */
  hoverWireId: string | null = null;
  /** The ruler of the panel view: whether it is on and the last thing measured. Not part of the project. */
  ruler: { on: boolean; line: RulerLine | null } = { on: false, line: null };
  notify: (message: string, isError?: boolean) => void = () => {};
  private readonly history = new History<Document>({ project: emptyProject(), snapshot: {} });
  private readonly listeners = new Set<() => void>();

  get project(): Project {
    return this.history.current.project;
  }

  get snapshot(): Record<string, ModuleDef> {
    return this.history.current.snapshot;
  }

  /** Changes whenever the project or its module definitions do; what autosave watches. */
  get revision(): object {
    return this.history.current;
  }

  /** Faults and advice to mark on the drawings, found again only when the project, the libraries or the cable settings change. */
  get findings(): Finding[] {
    const revision = this.revision;
    const cache = this.findingCache;
    if (!cache || cache.revision !== revision || cache.libraries !== this.libraries || cache.settings !== this.cableSettings) {
      this.findingCache = { revision, libraries: this.libraries, settings: this.cableSettings, list: [...findFindings(this.project, this.resolve, this.cableSettings), ...findPlacementFindings(this.project, this.sizes, this.resolve), ...findDuctFillFindings(this.project, this.resolve)] };
    }
    return this.findingCache!.list;
  }

  /** The finding to keep marked after Check is closed, until something else is selected. */
  focusFinding(finding: Finding): void {
    this.focusedMessage = finding.message;
    this.changed();
  }

  /** The findings the drawings mark: all while Check is open, the picked one after it is closed, none while exporting. */
  get markedFindings(): Finding[] {
    if (!this.marksVisible) return [];
    if (this.checkOpen) return this.findings;
    return this.focusedMessage === null ? [] : this.findings.filter((f) => f.message === this.focusedMessage);
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  /** The definition in the libraries only, ignoring what the project stored. */
  readonly libraryResolve = (ref: ModuleRef): ModuleDef | undefined =>
    this.libraries.find((l) => l.id === ref.libraryId)?.modules.find((m) => m.id === ref.moduleId);

  readonly resolve = (ref: ModuleRef): ModuleDef | undefined =>
    this.snapshot[moduleKey(ref)] ?? this.libraryResolve(ref);

  private readonly lookups = lookupsOf(this.resolve);
  readonly widthOf = this.lookups.widthOf;
  readonly resizeOf = this.lookups.resizeOf;
  readonly combLookup = this.lookups.combLookup;
  readonly sizes = this.lookups.sizes;

  /** The plate the panel view shows; the first one when the one chosen is gone, as after an undo. */
  get plateId(): string {
    const { plates } = this.project.panel;
    return plateById(this.project.panel, this.plateChosen) ? this.plateChosen : plates[0]!.id;
  }

  set plateId(id: string) {
    this.plateChosen = id;
  }

  /** The plate on view as a panel of its own, found again only when the panel or the plate changes. */
  get scope(): PlateScope {
    const { panel } = this.project;
    const plate = this.plateId;
    if (!this.scopeCache || this.scopeCache.panel !== panel || this.scopeCache.plate !== plate) this.scopeCache = { panel, plate, scope: scopeToPlate(panel, plate) };
    return this.scopeCache.scope;
  }

  /** The notes a drawing shows: those being dragged, or those of the project. */
  notesOf(mode: Mode): Annotation[] | undefined {
    if (this.annotationDraft?.mode === mode) return this.annotationDraft.list;
    return mode === 'panel' ? notesOnPlate(this.project.panel, this.plateId) : this.project.schematic.annotations;
  }

  subscribe(listener: () => void): void {
    this.listeners.add(listener);
  }

  changed(): void {
    this.listeners.forEach((listener) => listener());
  }

  select(selection: Selection): void {
    this.selection = selection;
    this.focusedMessage = null;
    const plate = plateOfSelection(this.project.panel, selection);
    if (plate) this.plateChosen = plate;
    this.changed();
  }

  /** Commits a change; pass `snapshot` when the stored module definitions change with it. */
  commit(project: Project, snapshot: Record<string, ModuleDef> = this.snapshot): void {
    this.history.commit({ project, snapshot });
    // A thing that was moved to another plate is followed there.
    const plate = plateOfSelection(project.panel, this.selection);
    if (plate) this.plateChosen = plate;
    this.changed();
  }

  reset(project: Project): void {
    this.replace(project, {});
  }

  load(file: ProjectFile): void {
    this.replace(file.project, file.modules);
  }

  toFile(): ProjectFile {
    return buildProjectFile(this.project, this.resolve);
  }

  undo(): void {
    if (this.history.undo()) this.afterHistoryMove();
  }

  redo(): void {
    if (this.history.redo()) this.afterHistoryMove();
  }

  private replace(project: Project, modules: Record<string, ModuleDef>): void {
    this.history.reset({ project, snapshot: modules });
    this.plateChosen = project.panel.plates[0]!.id;
    this.selection = {};
    this.changed();
  }

  private afterHistoryMove(): void {
    const { panel, schematic } = this.project;
    const { nodeId, rail } = this.selection;
    const kept = selectedIds(this.selection);
    this.selection = {
      ...groupSelection(
        kept.placements.filter((id) => panel.placements.some((p) => p.id === id)),
        kept.combs.filter((id) => panel.combs.some((c) => c.id === id)),
        kept.ducts.filter((id) => ductsOf(panel).some((d) => d.id === id)),
      ),
      ...(rail !== undefined && rail < panel.rails.length ? { rail } : {}),
      ...(nodeId && schematic.nodes.some((n) => n.id === nodeId) ? { nodeId } : {}),
      ...wireGroupSelection(selectedWires(this.selection).filter((id) => schematic.wires.some((w) => w.id === id))),
    };
    this.changed();
  }
}
