import { iconLabel } from '../i18n';
import type { IconCategory } from '../library/genericIcons';
import { NO_ICON, OWN_ICON_SOURCE } from '../library/icons';
import { shapesToSvg } from '../library/svgExport';
import { filterIcons, type IconEntry } from './iconCatalog';

export interface IconPickerOptions {
  /** What is stored now: an icon key, `none`, or nothing. */
  current: string | undefined;
  /** A device may refuse the icon of its load; a load either has one or not. */
  forDevice: boolean;
  entries: () => IconEntry[];
  categories: () => IconCategory[];
  /** Adds SVG files to the person's own icons and says how it went. */
  importFiles: (files: File[]) => Promise<string>;
  /** Removes one of the person's own icons, after asking, and says how it went. */
  deleteIcon: (key: string) => Promise<string>;
}

const button = (label: string, className = ''): HTMLButtonElement => {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = label;
  if (className) el.className = className;
  return el;
};

/**
 * Lets the person pick an icon. Resolves with the key, '' for automatic (a device: from its load; a
 * load: none), `none` for a device that is to have none, or null when the dialog is closed.
 */
export function pickIcon(options: IconPickerOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'app-dialog icon-picker';
    let answer: string | null = null;
    const choose = (value: string) => {
      answer = value;
      dialog.close();
    };

    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search icons';
    const category = document.createElement('select');
    const grid = document.createElement('div');
    grid.className = 'icon-grid';
    const empty = document.createElement('div');
    empty.className = 'icon-status';
    const status = document.createElement('div');
    status.className = 'icon-status';

    const fillCategories = () => {
      const chosen = category.value;
      const all = document.createElement('option');
      all.value = '';
      all.textContent = 'All';
      category.replaceChildren(all, ...options.categories().map((c) => {
        const option = document.createElement('option');
        option.value = c.id;
        option.textContent = iconLabel(c.name);
        return option;
      }));
      category.value = chosen;
    };
    const fillGrid = () => {
      const shown = filterIcons(options.entries(), search.value, category.value, iconLabel);
      grid.replaceChildren(
        ...shown.map(({ key, icon }) => {
          const item = document.createElement('div');
          item.className = 'icon-item';
          const cell = button('', key === options.current ? 'icon-cell chosen' : 'icon-cell');
          cell.title = iconLabel(icon.name);
          const picture = document.createElement('span');
          picture.className = 'icon-picture';
          picture.innerHTML = shapesToSvg(icon.art, icon.widthMm, icon.heightMm);
          const name = document.createElement('span');
          name.className = 'icon-name';
          name.textContent = iconLabel(icon.name);
          cell.append(picture, name);
          cell.addEventListener('click', () => choose(key));
          item.append(cell);
          if (key.startsWith(`${OWN_ICON_SOURCE}/`)) {
            const remove = button('×', 'icon-delete');
            remove.title = 'Delete this icon';
            remove.addEventListener('click', async () => {
              status.textContent = await options.deleteIcon(key);
              fillCategories();
              fillGrid();
            });
            item.append(remove);
          }
          return item;
        }),
      );
      empty.textContent = shown.length === 0 ? 'No icon matches.' : '';
    };
    search.addEventListener('input', fillGrid);
    // Enter would also press the button that opened the dialog, which keeps the focus behind it.
    search.addEventListener('keydown', (e) => e.key === 'Enter' && e.preventDefault());
    category.addEventListener('change', fillGrid);

    const file = document.createElement('input');
    file.type = 'file';
    file.accept = '.svg,image/svg+xml';
    file.multiple = true;
    file.hidden = true;
    file.addEventListener('change', async () => {
      const files = [...(file.files ?? [])];
      file.value = '';
      if (files.length === 0) return;
      status.textContent = await options.importFiles(files);
      fillCategories();
      fillGrid();
    });
    const importButton = button('Import SVG…');
    importButton.addEventListener('click', () => file.click());

    const automatic = button(options.forDevice ? 'From its load' : 'No icon');
    automatic.addEventListener('click', () => choose(''));
    const none = button('No icon');
    none.addEventListener('click', () => choose(NO_ICON));
    const cancel = button('Cancel');
    cancel.addEventListener('click', () => dialog.close());

    const top = document.createElement('div');
    top.className = 'icon-filters';
    top.append(search, category);
    const actions = document.createElement('div');
    actions.className = 'app-dialog-actions';
    actions.append(importButton, file, automatic, ...(options.forDevice ? [none] : []), cancel);
    dialog.append(top, grid, empty, status, actions);
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(answer);
    });
    fillCategories();
    fillGrid();
    document.body.append(dialog);
    dialog.showModal();
    search.focus();
  });
}
