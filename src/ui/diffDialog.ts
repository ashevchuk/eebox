import { AREA_TITLES, summarize, type Change, type ChangeArea, type ChangeKind } from '../project/diff';

const MAX_SHOWN = 400;
const MARKS: Record<ChangeKind, string> = { added: '+', removed: '−', changed: '~' };

/** What differs between two projects, by area: what only the other one has was added, what only this one has was removed. */
export function openDiffDialog(heading: string, other: string, changes: readonly Change[]): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'app-dialog diff-dialog';
  const title = document.createElement('h2');
  title.textContent = heading;
  const summary = document.createElement('p');
  summary.className = 'diff-summary';
  const counts = summarize(changes);
  summary.textContent =
    counts.total === 0
      ? 'No differences.'
      : `${counts.total} difference${counts.total === 1 ? '' : 's'}: ${counts.added} added, ${counts.removed} removed, ${counts.changed} changed. Added means "${other}" has it and the project on the screen does not.`;
  const body = document.createElement('div');
  body.className = 'diff-body';
  const shown = changes.slice(0, MAX_SHOWN);
  for (const area of [...new Set(shown.map((c) => c.area))] as ChangeArea[]) {
    const heading2 = document.createElement('h3');
    heading2.textContent = AREA_TITLES[area];
    const list = document.createElement('ul');
    for (const change of shown.filter((c) => c.area === area)) {
      const item = document.createElement('li');
      item.className = `diff-${change.kind}`;
      const mark = document.createElement('span');
      mark.className = 'diff-mark';
      mark.textContent = MARKS[change.kind];
      item.append(mark, ` ${change.text}`);
      list.append(item);
    }
    body.append(heading2, list);
  }
  if (changes.length > shown.length) body.append(Object.assign(document.createElement('p'), { className: 'diff-summary', textContent: `and ${changes.length - shown.length} more.` }));
  const actions = document.createElement('div');
  actions.className = 'app-dialog-actions';
  const close = document.createElement('button');
  close.textContent = 'Close';
  close.className = 'primary';
  close.addEventListener('click', () => dialog.close());
  actions.append(close);
  dialog.append(title, summary, body, actions);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
}
