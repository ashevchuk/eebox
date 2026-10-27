import { DEFAULT_CABLE_SETTINGS, type CableSettings } from '../electrical/cables';
import { lookupsOf } from '../layout/lookups';
import { createPanel } from '../layout/panel';
import type { ModuleRef } from '../layout/placement';
import type { Library, ModuleDef } from '../library/types';
import type { Project } from '../project';
import { buildProjectFile, moduleKey, type ProjectFile } from '../project/file';
import { emptySchematic } from '../schematic/model';
import { findFindings, type Finding } from '../electrical/problems';
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
  /** The tool that puts a note on the drawing is on: the next press and drag on the drawing writes one. */
  noteTool = false;
  /** The notes of the view that is on while one is being dragged, before the drag is committed. */
  annotationDraft: { mode: Mode; list: Annotation[] } | null = null;
  selection: Selection = {};
  /** Whether the drawings mark the faults and the advice; off while exporting, so a drawing for others is not full of red. */
  marksVisible = true;
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
      this.findingCache = { revision, libraries: this.libraries, settings: this.cableSettings, list: findFindings(this.project, this.resolve, this.cableSettings) };
    }
    return this.findingCache!.list;
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

  /** The notes a drawing shows: those being dragged, or those of the project. */
  notesOf(mode: Mode): Annotation[] | undefined {
    if (this.annotationDraft?.mode === mode) return this.annotationDraft.list;
    return mode === 'panel' ? this.project.panel.annotations : this.project.schematic.annotations;
  }

  subscribe(listener: () => void): void {
    this.listeners.add(listener);
  }

  changed(): void {
    this.listeners.forEach((listener) => listener());
  }

  select(selection: Selection): void {
    this.selection = selection;
    this.changed();
  }

  /** Commits a change; pass `snapshot` when the stored module definitions change with it. */
  commit(project: Project, snapshot: Record<string, ModuleDef> = this.snapshot): void {
    this.history.commit({ project, snapshot });
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
      ),
      ...(rail !== undefined && rail < panel.railLengthsUnits.length ? { rail } : {}),
      ...(nodeId && schematic.nodes.some((n) => n.id === nodeId) ? { nodeId } : {}),
      ...wireGroupSelection(selectedWires(this.selection).filter((id) => schematic.wires.some((w) => w.id === id))),
    };
    this.changed();
  }
}
