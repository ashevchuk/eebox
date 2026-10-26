import { createPanel } from '../layout/panel';
import type { ModuleRef, WidthOf } from '../layout/placement';
import type { Library, ModuleDef } from '../library/types';
import type { Project } from '../project';
import { buildProjectFile, moduleKey, type ProjectFile } from '../project/file';
import { emptySchematic } from '../schematic/model';
import { History } from '../view/history';

export type Mode = 'panel' | 'schematic';

export interface Selection {
  placementId?: string;
  nodeId?: string;
  wireId?: string;
}

export const emptyProject = (): Project => ({
  panel: createPanel([]),
  schematic: emptySchematic(),
});

/** State shared by the panel and schematic views. */
export class Session {
  libraries: Library[] = [];
  mode: Mode = 'panel';
  selection: Selection = {};
  notify: (message: string, isError?: boolean) => void = () => {};
  private readonly history = new History<Project>(emptyProject());
  /** Module definitions stored in the loaded project; they win over libraries so a design stays reproducible. */
  private snapshot = new Map<string, ModuleDef>();
  private readonly listeners = new Set<() => void>();

  get project(): Project {
    return this.history.current;
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  readonly resolve = (ref: ModuleRef): ModuleDef | undefined =>
    this.snapshot.get(moduleKey(ref)) ??
    this.libraries.find((l) => l.id === ref.libraryId)?.modules.find((m) => m.id === ref.moduleId);

  readonly widthOf: WidthOf = (ref) => this.resolve(ref)?.widthUnits;

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

  commit(project: Project): void {
    this.history.commit(project);
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
    this.history.reset(project);
    this.snapshot = new Map(Object.entries(modules));
    this.selection = {};
    this.changed();
  }

  private afterHistoryMove(): void {
    const { panel, schematic } = this.project;
    const { placementId, nodeId, wireId } = this.selection;
    this.selection = {
      ...(placementId && panel.placements.some((p) => p.id === placementId) ? { placementId } : {}),
      ...(nodeId && schematic.nodes.some((n) => n.id === nodeId) ? { nodeId } : {}),
      ...(wireId && schematic.wires.some((w) => w.id === wireId) ? { wireId } : {}),
    };
    this.changed();
  }
}
