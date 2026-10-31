import type { Finding } from '../electrical/problems';
import type { ProblemEntry } from './problems';

const SEVERITY_LABEL: Record<ProblemEntry['severity'], string> = { error: 'Error', advice: 'Advice', note: 'Note' };

/** The list of what Check found, kept on the drawing's side so a click can take the eye to the thing. */
export class ProblemsView {
  private shown = false;
  /** What the list on the screen was made from; the list is not made again while it is the same. */
  private drawnFrom: string | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly entries: () => ProblemEntry[],
    private readonly onPick: (finding: Finding) => void,
  ) {
    root.hidden = true;
  }

  get visible(): boolean {
    return this.shown;
  }

  toggle(): void {
    this.shown = !this.shown;
    this.root.hidden = !this.shown;
    this.drawnFrom = null;
    if (this.shown) this.render();
  }

  hide(): void {
    this.shown = false;
    this.root.hidden = true;
    this.drawnFrom = null;
  }

  /**
   * Draws the list again; it does nothing while the list is hidden or what it shows has not changed. Making it
   * again anyway would replace the button under the pointer between a press and its release, and the click would be lost.
   */
  render(): void {
    if (!this.shown) return;
    const entries = this.entries();
    const key = JSON.stringify(entries.map((e) => [e.severity, e.message, e.finding !== undefined]));
    if (key === this.drawnFrom) return;
    this.drawnFrom = key;
    const header = document.createElement('div');
    header.className = 'problems-header';
    const title = document.createElement('strong');
    const faults = entries.filter((e) => e.severity === 'error').length;
    title.textContent = entries.length === 0 ? 'No problems found' : `${entries.length} to look at${faults > 0 ? `, ${faults} wrong` : ''}`;
    const close = document.createElement('button');
    close.textContent = 'Close';
    close.addEventListener('click', () => this.hide());
    header.append(title, close);
    const list = document.createElement('ul');
    list.className = 'problems-list';
    for (const entry of entries) {
      const item = document.createElement('li');
      const row = document.createElement('button');
      row.className = `problem ${entry.severity}`;
      row.disabled = entry.finding === undefined;
      row.title = entry.finding ? 'Show it on the drawing' : 'This is about the project as a whole';
      const badge = document.createElement('span');
      badge.className = 'problem-badge';
      badge.textContent = SEVERITY_LABEL[entry.severity];
      const message = document.createElement('span');
      message.textContent = entry.message;
      row.append(badge, message);
      row.addEventListener('click', () => entry.finding && this.onPick(entry.finding));
      item.append(row);
      list.append(item);
    }
    this.root.replaceChildren(header, list);
  }
}
