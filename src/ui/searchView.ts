import type { SearchResult } from './search';

/** A box over the stage to find a module, node or wire by what it is called; a pick takes the eye to it. */
export class SearchView {
  private readonly input = document.createElement('input');
  private readonly list = document.createElement('ul');
  private results: SearchResult[] = [];
  private active = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly search: (query: string) => SearchResult[],
    private readonly onPick: (result: SearchResult) => void,
  ) {
    root.hidden = true;
    this.input.type = 'search';
    this.input.placeholder = 'Find by label, name, article number or id';
    this.input.autocomplete = 'off';
    this.input.setAttribute('aria-label', 'Find on the drawings');
    this.list.className = 'search-results';
    root.append(this.input, this.list);
    this.input.addEventListener('input', () => this.update());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (this.results.length > 0) this.highlight((this.active + (e.key === 'ArrowDown' ? 1 : -1) + this.results.length) % this.results.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const picked = this.results[this.active];
        if (picked) this.pick(picked);
      }
    });
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.root.hidden = false;
    this.input.focus();
    this.input.select();
    this.update();
  }

  close(): void {
    this.root.hidden = true;
    this.input.blur();
  }

  private pick(result: SearchResult): void {
    this.close();
    this.onPick(result);
  }

  private update(): void {
    this.results = this.search(this.input.value);
    this.active = 0;
    this.list.replaceChildren(
      ...this.results.map((result, i) => {
        const item = document.createElement('li');
        const row = document.createElement('button');
        row.className = `search-result${i === 0 ? ' active' : ''}`;
        const title = document.createElement('span');
        title.textContent = result.title;
        const detail = document.createElement('small');
        detail.textContent = result.detail;
        row.append(title, detail);
        row.addEventListener('click', () => this.pick(result));
        item.append(row);
        return item;
      }),
    );
    if (this.input.value.trim() !== '' && this.results.length === 0) {
      const none = document.createElement('li');
      none.className = 'search-none';
      none.textContent = 'Nothing found.';
      this.list.append(none);
    }
  }

  private highlight(index: number): void {
    this.active = index;
    this.list.querySelectorAll('.search-result').forEach((row, i) => row.classList.toggle('active', i === index));
    this.list.querySelectorAll('.search-result')[index]?.scrollIntoView({ block: 'nearest' });
  }
}
