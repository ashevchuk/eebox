import type { Snippet } from '../layout/snippets';

export interface SnippetHandlers {
  onSaveSelection(): void;
  onInsert(snippet: Snippet): void;
  onRemove(snippet: Snippet): void;
}

const describe = (snippet: Snippet): string => {
  const { placements, combs } = snippet.file.project.panel;
  const modules = placements.length + combs.length;
  return `${modules} module${modules === 1 ? '' : 's'}`;
};

/** The snippets in the sidebar: the selection is saved as one, a click puts one on the panel. */
export class SnippetsView {
  constructor(
    private readonly root: HTMLElement,
    private readonly handlers: SnippetHandlers,
  ) {}

  render(snippets: readonly Snippet[]): void {
    const heading = document.createElement('h3');
    heading.textContent = `Snippets (${snippets.length})`;
    const save = document.createElement('button');
    save.className = 'wide-button';
    save.textContent = 'Save selection as snippet…';
    save.title = 'Keep the selected modules, with the wires between them, to put on a panel again';
    save.addEventListener('click', () => this.handlers.onSaveSelection());
    const items = snippets.map((snippet) => {
      const row = document.createElement('div');
      row.className = 'snippet';
      const name = document.createElement('span');
      name.className = 'snippet-name';
      name.textContent = snippet.name;
      const detail = document.createElement('small');
      detail.textContent = ` ${describe(snippet)}`;
      name.append(detail);
      const insert = document.createElement('button');
      insert.textContent = 'Insert';
      insert.title = 'Put this group on the panel, at the selected row or the first one';
      insert.addEventListener('click', () => this.handlers.onInsert(snippet));
      const remove = document.createElement('button');
      remove.textContent = '×';
      remove.title = 'Take this snippet away';
      remove.addEventListener('click', () => this.handlers.onRemove(snippet));
      row.append(name, insert, remove);
      return row;
    });
    this.root.replaceChildren(heading, ...items, save);
  }
}
