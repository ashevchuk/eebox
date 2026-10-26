import { KIND_LABELS, groupByKind, matchesQuery } from '../library/catalog';
import { stableStringify } from '../library/equality';
import { MODULE_KINDS, type Library, type ModuleKind } from '../library/types';
import { validateLibrary, type ValidationError } from '../library/validate';
import { FieldsView } from './fieldsView';
import {
  addEnclosure,
  addModule,
  applyEditorAction,
  applyEditorEdit,
  describeEditor,
  validateDraft,
  type EditorState,
  type EditorTarget,
} from './libraryEditor';

/** What the editor needs from the application around it. */
export interface EditorHost {
  /** Libraries that exist right now, to catch an id that is already taken. */
  libraries(): Library[];
  /** The id of the bundled library, which is refreshed at start-up and so cannot be used. */
  bundledId: string;
  /** Stores the library; `replacesId` is the id it was stored under before, if it changed. */
  save(library: Library, replacesId: string | null): Promise<void>;
  exportLibrary(library: Library): void;
  askConfirmation(message: string, confirmLabel: string): Promise<boolean>;
}

export interface EditorOptions {
  /** True when the library has never been stored, so it can be saved as it is. */
  isNew: boolean;
  /** The id the library is stored under, or null for one that is not stored yet. */
  originalId: string | null;
}

const MAX_SHOWN_ERRORS = 8;

const same = (a: EditorTarget, b: EditorTarget) => a.kind === b.kind && ('id' in a && 'id' in b ? a.id === b.id : true);

/** A modal editor for one library: browse its modules and enclosures, edit them in forms, check and save. */
export class LibraryEditorView {
  private state: EditorState;
  private savedText: string;
  private originalId: string | null;
  private query = '';
  private message = '';
  private messageIsError = false;
  private readonly dialog = document.createElement('dialog');
  private readonly list = document.createElement('nav');
  private readonly errors = document.createElement('div');
  private readonly status = document.createElement('span');
  private readonly saveButton = document.createElement('button');
  private readonly fields: FieldsView;

  constructor(
    library: Library,
    private readonly options: EditorOptions,
    private readonly host: EditorHost,
  ) {
    this.state = { draft: library, target: { kind: 'library' } };
    this.savedText = options.isNew ? '' : stableStringify(library);
    this.originalId = options.originalId;

    const body = document.createElement('div');
    body.className = 'editor-body';
    const fieldsPane = document.createElement('section');
    fieldsPane.className = 'editor-fields';
    this.list.className = 'editor-list';
    body.append(this.list, fieldsPane);
    this.fields = new FieldsView(fieldsPane, {
      onEdit: (key, raw) => this.edit(key, typeof raw === 'string' ? raw : raw.join(' ')),
      onAction: (action) => this.act(action.key),
    });
    this.errors.className = 'editor-errors';

    const header = document.createElement('header');
    const title = document.createElement('h2');
    title.textContent = 'Library editor';
    this.saveButton.textContent = 'Save';
    this.saveButton.className = 'primary';
    this.saveButton.addEventListener('click', () => void this.save());
    const exportButton = this.button('Export', () => this.export());
    const closeButton = this.button('Close', () => void this.close());
    this.status.className = 'editor-status';
    header.append(title, this.status, this.saveButton, exportButton, closeButton);

    this.dialog.className = 'app-dialog editor-dialog';
    this.dialog.append(header, body, this.errors);
    this.dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      void this.close();
    });
    this.dialog.addEventListener('close', () => this.dialog.remove());
  }

  open(): void {
    document.body.append(this.dialog);
    this.dialog.showModal();
    this.renderAll();
  }

  private get dirty(): boolean {
    return stableStringify(this.state.draft) !== this.savedText;
  }

  /** Problems that stop a save: what the validator finds, and ids that cannot be used. */
  private problems(): ValidationError[] {
    const { draft } = this.state;
    const extra: ValidationError[] = [];
    if (draft.id === this.host.bundledId) {
      extra.push({ path: 'id', message: 'belongs to the bundled library; use another id' });
    } else if (draft.id !== this.originalId && this.host.libraries().some((l) => l.id === draft.id)) {
      extra.push({ path: 'id', message: 'is used by another library' });
    }
    return [...validateDraft(draft), ...extra];
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  private say(message: string, isError = false): void {
    this.message = message;
    this.messageIsError = isError;
    this.renderStatus();
  }

  private renderStatus(): void {
    this.status.textContent = this.message;
    this.status.classList.toggle('error', this.messageIsError);
  }

  private renderAll(forceFields = false): void {
    this.renderList();
    this.fields.render(describeEditor(this.state), forceFields);
    const problems = this.problems();
    this.errors.replaceChildren();
    if (problems.length > 0) {
      const shown = problems.slice(0, MAX_SHOWN_ERRORS).map((p) => `${p.path || '(library)'}: ${p.message}`);
      const hidden = problems.length - shown.length;
      this.errors.textContent = [...shown, ...(hidden > 0 ? [`${hidden} more`] : [])].join('\n');
    }
    this.saveButton.disabled = problems.length > 0 || (!this.dirty && !this.options.isNew);
    this.renderStatus();
  }

  private renderList(): void {
    const { draft, target } = this.state;
    const failing = new Set(
      validateDraft(draft).flatMap((e) => {
        const match = /^(modules|enclosures)\[(\d+)\]/.exec(e.path);
        return match ? [`${match[1]}:${match[2]}`] : [];
      }),
    );
    this.list.replaceChildren();

    const entry = (label: string, entryTarget: EditorTarget, failed: boolean): HTMLElement => {
      const row = document.createElement('div');
      row.className = `editor-item${same(entryTarget, target) ? ' selected' : ''}${failed ? ' failed' : ''}`;
      row.textContent = label;
      row.addEventListener('click', () => {
        this.state = { ...this.state, target: entryTarget };
        this.renderAll(true);
      });
      return row;
    };

    this.list.append(entry('Library', { kind: 'library' }, validateDraft(draft).some((e) => !/^(modules|enclosures)\[/.test(e.path))));

    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search modules';
    search.value = this.query;
    search.addEventListener('input', () => {
      this.query = search.value;
      this.renderList();
      this.list.querySelector<HTMLInputElement>('input[type=search]')?.focus();
    });

    const kind = document.createElement('select');
    for (const k of MODULE_KINDS) {
      const option = document.createElement('option');
      option.value = k;
      option.textContent = KIND_LABELS[k];
      kind.append(option);
    }
    const add = this.button('Add module', () => {
      const created = addModule(this.state.draft, kind.value as ModuleKind);
      this.state = { draft: created.draft, target: { kind: 'module', id: created.id } };
      this.renderAll(true);
    });
    const tools = document.createElement('div');
    tools.className = 'editor-tools';
    tools.append(kind, add);
    this.list.append(this.heading(`Modules (${draft.modules.length})`), tools, search);

    for (const group of groupByKind(draft.modules)) {
      const matching = group.modules.filter((m) => matchesQuery(m, this.query));
      if (matching.length === 0) continue;
      const details = document.createElement('details');
      details.open = this.query.trim() !== '' || group.modules.some((m) => target.kind === 'module' && m.id === target.id) || draft.modules.length <= 24;
      const summary = document.createElement('summary');
      summary.textContent = `${KIND_LABELS[group.kind]} (${matching.length})`;
      details.append(summary);
      for (const module of matching) {
        details.append(entry(module.name || module.id, { kind: 'module', id: module.id }, failing.has(`modules:${draft.modules.indexOf(module)}`)));
      }
      this.list.append(details);
    }

    this.list.append(
      this.heading(`Enclosures (${draft.enclosures.length})`),
      this.button('Add enclosure', () => {
        const created = addEnclosure(this.state.draft);
        this.state = { draft: created.draft, target: { kind: 'enclosure', id: created.id } };
        this.renderAll(true);
      }),
    );
    draft.enclosures.forEach((enclosure, i) => {
      this.list.append(entry(enclosure.name || enclosure.id, { kind: 'enclosure', id: enclosure.id }, failing.has(`enclosures:${i}`)));
    });
  }

  private heading(text: string): HTMLElement {
    const heading = document.createElement('h3');
    heading.textContent = text;
    return heading;
  }

  private edit(key: string, raw: string): void {
    const result = applyEditorEdit(this.state, key, raw);
    if (!result.ok) {
      this.say(result.message, true);
      this.renderAll(true);
      return;
    }
    this.state = { draft: result.draft, target: result.target ?? this.state.target };
    this.message = '';
    this.renderAll();
  }

  private act(key: string): void {
    const result = applyEditorAction(this.state, key);
    if (!result.ok) {
      this.say(result.message, true);
      return;
    }
    this.state = { draft: result.draft, target: result.target ?? this.state.target };
    this.message = '';
    this.renderAll(true);
  }

  private validated(): Library | null {
    const result = validateLibrary(this.state.draft);
    return result.ok && this.problems().length === 0 ? result.library : null;
  }

  private async save(): Promise<void> {
    const library = this.validated();
    if (!library) {
      this.say('Fix the problems listed below first.', true);
      return;
    }
    try {
      await this.host.save(library, this.originalId);
    } catch (error) {
      this.say(`Saving failed: ${(error as Error).message}`, true);
      return;
    }
    this.originalId = library.id;
    this.options.isNew = false;
    this.savedText = stableStringify(this.state.draft);
    this.say(`Saved "${library.name}".`);
    this.renderAll();
  }

  private export(): void {
    const library = this.validated();
    if (library) this.host.exportLibrary(library);
    else this.say('Fix the problems listed below before exporting.', true);
  }

  private async close(): Promise<void> {
    if (this.dirty) {
      if (!(await this.host.askConfirmation('Close the editor and discard the changes you have not saved?', 'Discard'))) return;
    }
    this.dialog.close();
  }
}

/** Opens the editor on a library; the editor works on the copy it is given. */
export function openLibraryEditor(library: Library, options: EditorOptions, host: EditorHost): void {
  new LibraryEditorView(library, options, host).open();
}
