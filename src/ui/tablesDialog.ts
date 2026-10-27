import type { Table } from './tables';
import { sortedIndices } from './tables';

export interface TablesHost {
  /** Applies a typed value to the object of a row; the message of a refusal, or null when it was applied. */
  edit(table: Table, row: number, column: number, raw: string): string | null;
  /** The tables as they are now, after an edit. */
  tables(): Table[];
}

/** The lists of the project in a dialog: one tab for each, a click on a heading sorts by it, some cells can be typed over. */
export function openTablesDialog(start: Table[], host: TablesHost, heading = 'Tables of the project'): void {
  let tables = start;
  const dialog = document.createElement('dialog');
  dialog.className = 'app-dialog tables-dialog';
  const title = document.createElement('h2');
  title.textContent = heading;
  const tabs = document.createElement('div');
  tabs.className = 'tables-tabs';
  const body = document.createElement('div');
  body.className = 'tables-body';
  const problem = document.createElement('p');
  problem.className = 'tables-problem';
  problem.hidden = true;
  const sort = { column: -1, descending: false };
  let current = 0;

  const show = (focus?: { shown: number; column: number }) => {
    const table = tables[current]!;
    problem.hidden = true;
    tabs.replaceChildren(
      ...tables.map((t, i) => {
        const tab = document.createElement('button');
        tab.textContent = `${t.title} (${t.rows.length})`;
        tab.classList.toggle('active', i === current);
        tab.addEventListener('click', () => {
          current = i;
          sort.column = -1;
          show();
        });
        return tab;
      }),
    );
    if (table.rows.length === 0) {
      body.replaceChildren(Object.assign(document.createElement('p'), { className: 'tables-empty', textContent: table.empty }));
      return;
    }
    const order = sort.column >= 0 ? sortedIndices(table, sort.column, sort.descending) : table.rows.map((_, i) => i);
    const el = document.createElement('table');
    const head = el.createTHead().insertRow();
    table.columns.forEach((column, c) => {
      const th = document.createElement('th');
      th.textContent = `${column.label}${column.edit ? ' ✎' : ''}${sort.column === c ? (sort.descending ? ' ▾' : ' ▴') : ''}`;
      th.className = column.numeric ? 'numeric' : '';
      th.title = column.edit ? 'Sort by this column; its cells can be typed over' : 'Sort by this column';
      th.addEventListener('click', () => {
        sort.descending = sort.column === c ? !sort.descending : false;
        sort.column = c;
        show();
      });
      head.append(th);
    });
    const tbody = el.createTBody();
    order.forEach((rowIndex, shown) => {
      const tr = tbody.insertRow();
      table.rows[rowIndex]!.forEach((value, c) => {
        const td = tr.insertCell();
        const column = table.columns[c];
        const mark = table.marks?.[rowIndex]?.[c];
        td.className = [column?.numeric ? 'numeric' : '', mark ? `mark-${mark}` : ''].filter(Boolean).join(' ');
        const hint = table.titles?.[rowIndex]?.[c];
        if (hint) td.title = hint;
        if (!column?.edit || !table.selections?.[rowIndex]) {
          td.textContent = String(value);
          return;
        }
        const input = document.createElement('input');
        input.className = 'table-edit';
        input.value = String(value);
        input.dataset.shown = String(shown);
        input.dataset.column = String(c);
        const commit = () => {
          if (input.value === String(value)) return true;
          const message = host.edit(table, rowIndex, c, input.value);
          if (message !== null) {
            input.value = String(value);
            problem.textContent = message;
            problem.hidden = false;
            return false;
          }
          tables = host.tables();
          return true;
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            input.value = String(value);
            return;
          }
          if (e.key !== 'Enter') return;
          e.preventDefault();
          e.stopPropagation();
          if (commit()) show({ shown: Math.min(shown + 1, order.length - 1), column: c });
        });
        input.addEventListener('change', () => {
          if (commit()) show();
        });
        td.append(input);
      });
    });
    body.replaceChildren(el, ...(table.note ? [Object.assign(document.createElement('p'), { className: 'tables-note', textContent: table.note })] : []));
    if (focus) body.querySelector<HTMLInputElement>(`input[data-shown="${focus.shown}"][data-column="${focus.column}"]`)?.focus();
  };

  const actions = document.createElement('div');
  actions.className = 'app-dialog-actions';
  const close = document.createElement('button');
  close.textContent = 'Close';
  close.className = 'primary';
  close.addEventListener('click', () => dialog.close());
  actions.append(close);
  dialog.append(title, tabs, body, problem, actions);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  show();
  dialog.showModal();
}
