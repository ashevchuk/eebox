import { KIND_LABELS, groupByKind, matchesQuery } from '../library/catalog';
import type { ModuleRef } from '../layout/placement';
import type { Library, ModuleDef } from '../library/types';
import type { Session } from './session';

export interface PaletteHandlers {
  onDragStart(e: PointerEvent, def: ModuleDef, ref: ModuleRef): void;
  onExport(library: Library): void;
  onRemove(library: Library): void;
  onEdit(library: Library): void;
  /** For the bundled library, which is replaced at start-up: make a copy that can be edited. */
  onCopy(library: Library): void;
  isBundled(library: Library): boolean;
  /** Open the designer on a module of a library the user owns. */
  onEditModule(library: Library, def: ModuleDef): void;
  /** Make a copy of a module of the bundled library in the user's own library and design that. */
  onCopyModule(library: Library, def: ModuleDef): void;
}

const OPEN_STATE_KEY = 'eebox:palette-open';
const SMALL_GROUP = 12;

function loadOpenState(): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(OPEN_STATE_KEY) ?? '{}');
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/** The module palette: libraries, searchable, with each library split into collapsible groups by kind. */
export class PaletteView {
  private query = '';
  private readonly open = loadOpenState();

  constructor(
    private readonly container: HTMLElement,
    private readonly search: HTMLInputElement,
    private readonly session: Session,
    private readonly handlers: PaletteHandlers,
  ) {
    search.addEventListener('input', () => {
      this.query = search.value;
      this.render();
    });
  }

  render(): void {
    this.container.replaceChildren();
    const { libraries } = this.session;
    if (libraries.length === 0) {
      this.container.append(this.note('No libraries. Import a library JSON file or start a new one.'));
      return;
    }
    let shown = 0;
    for (const library of libraries) {
      const groups = groupByKind(library.modules)
        .map((group) => ({ ...group, matching: group.modules.filter((m) => matchesQuery(m, this.query)) }))
        .filter((group) => group.matching.length > 0);
      if (this.query.trim() !== '' && groups.length === 0) continue;
      this.container.append(this.header(library));
      if (library.modules.length === 0) this.container.append(this.note('This library has no modules yet.'));
      for (const group of groups) {
        this.container.append(this.group(library, group.kind, group.modules.length, group.matching));
        shown += group.matching.length;
      }
    }
    if (shown === 0 && this.query.trim() !== '') this.container.append(this.note('No module matches the search.'));
  }

  private note(text: string): HTMLElement {
    const note = document.createElement('div');
    note.className = 'hint';
    note.textContent = text;
    return note;
  }

  private header(library: Library): HTMLElement {
    const title = document.createElement('div');
    title.className = 'library-title';
    const name = document.createElement('span');
    name.textContent = library.name;
    const details = [library.version && `version ${library.version}`, library.vendor, library.description]
      .filter(Boolean)
      .join('\n');
    name.title = `${library.id}${details ? `\n${details}` : ''}`;
    title.append(name);
    if (library.version) {
      const version = document.createElement('small');
      version.textContent = `v${library.version}`;
      title.append(version);
    }
    if (library.url) {
      const link = document.createElement('a');
      link.href = library.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'source';
      link.title = library.url;
      title.append(link);
    }
    const bundled = this.handlers.isBundled(library);
    title.append(
      this.button(bundled ? 'copy' : 'edit', bundled ? 'Make an editable copy' : 'Edit this library', () =>
        bundled ? this.handlers.onCopy(library) : this.handlers.onEdit(library),
      ),
      this.button('export', 'Save as a JSON file', () => this.handlers.onExport(library)),
      this.button('×', 'Remove library', () => this.handlers.onRemove(library)),
    );
    return title;
  }

  private button(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.textContent = label;
    button.title = title;
    button.addEventListener('click', onClick);
    return button;
  }

  private group(library: Library, kind: ModuleDef['kind'], total: number, matching: ModuleDef[]): HTMLElement {
    const key = `${library.id}/${kind}`;
    const searching = this.query.trim() !== '';
    const details = document.createElement('details');
    details.className = 'palette-group';
    details.open = searching || (this.open[key] ?? total <= SMALL_GROUP);
    const summary = document.createElement('summary');
    summary.textContent = `${KIND_LABELS[kind]} (${searching ? `${matching.length}/${total}` : total})`;
    details.append(summary);
    details.addEventListener('toggle', () => {
      if (searching) return;
      this.open[key] = details.open;
      try {
        window.localStorage.setItem(OPEN_STATE_KEY, JSON.stringify(this.open));
      } catch {
        // Storage can be unavailable; the groups then just open as they did by default.
      }
    });
    for (const def of matching) details.append(this.item(library, def));
    return details;
  }

  private item(library: Library, def: ModuleDef): HTMLElement {
    const item = document.createElement('div');
    item.className = 'module';
    item.textContent = def.name;
    const detail = document.createElement('small');
    detail.textContent = ` ${def.widthUnits}u`;
    item.append(detail);
    const ref: ModuleRef = { libraryId: library.id, moduleId: def.id };
    const bundled = this.handlers.isBundled(library);
    const action = document.createElement('button');
    action.className = 'module-action';
    action.textContent = bundled ? 'copy' : 'edit';
    action.title = bundled ? 'Design a copy of this module in My modules' : 'Open this module in the designer';
    action.addEventListener('pointerdown', (e) => e.stopPropagation());
    action.addEventListener('click', () => (bundled ? this.handlers.onCopyModule(library, def) : this.handlers.onEditModule(library, def)));
    item.append(action);
    item.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      item.setPointerCapture(e.pointerId);
      this.handlers.onDragStart(e, def, ref);
    });
    return item;
  }
}
