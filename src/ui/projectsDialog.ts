import { stampParts } from '../layout/info';
import { newestFirst, savedProjects, snapshotsOf, type StoredProject } from '../project/projectStore';

export interface ProjectsHost {
  list(): Promise<StoredProject[]>;
  /** Which stored project the one on the screen came from, if any. */
  currentId(): string | null;
  /** Saves the project on the screen over the stored one it came from, or as a new one. */
  saveCurrent(): Promise<void>;
  saveAsNew(): Promise<void>;
  open(project: StoredProject): Promise<void>;
  remove(project: StoredProject): Promise<boolean>;
  /** Shows what differs between the project on the screen and this one. */
  compare(project: StoredProject): void;
  /** Downloads the project as a file to hand on. */
  export(project: StoredProject): void;
  /** Adds the project files to the list; says what became of each. */
  importFiles(files: File[]): Promise<string>;
}

const countParts = (p: StoredProject): string[] => {
  const { placements } = p.file.project.panel;
  const { wires, nodes } = p.file.project.schematic;
  return [`${placements.length} module${placements.length === 1 ? '' : 's'}`, `${nodes.length} node${nodes.length === 1 ? '' : 's'}`, `${wires.length} wire${wires.length === 1 ? '' : 's'}`];
};

/** The words under a project's name, as text nodes of their own, so that each can be put into another language. */
const detailOf = (p: StoredProject, current: boolean): string[] => {
  const [modules, nodes, wires] = countParts(p);
  const stamp = stampParts(p.file.project.panel.info).flatMap((part) => [' · ', part]);
  return [new Date(p.savedAt).toLocaleString(), ' · ', modules!, ', ', nodes!, ', ', wires!, ...stamp, ...(current ? [' · ', 'open now'] : [])];
};

/** The projects kept in this browser: save the one on the screen, open another, take one away. */
export async function openProjectsDialog(host: ProjectsHost): Promise<void> {
  const dialog = document.createElement('dialog');
  dialog.className = 'app-dialog projects-dialog';
  const title = document.createElement('h2');
  title.textContent = 'Projects in this browser';
  const help = document.createElement('p');
  help.className = 'projects-help';
  help.textContent = 'The project on the screen is also kept by itself, as one, for when the page is opened again; the ones here are kept until you take them away. Export sends one to somebody, and Import (or dropping files here) adds the ones that were sent.';
  const list = document.createElement('div');
  list.className = 'projects-list';
  const result = document.createElement('p');
  result.className = 'projects-result';
  result.hidden = true;
  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = '.json,application/json';
  importInput.multiple = true;
  importInput.hidden = true;
  const importFiles = async (files: File[]) => {
    result.textContent = await host.importFiles(files);
    result.hidden = false;
    await refresh();
  };
  importInput.addEventListener('change', async () => {
    const files = [...(importInput.files ?? [])];
    importInput.value = '';
    if (files.length > 0) await importFiles(files);
  });
  const importButton = document.createElement('button');
  importButton.textContent = 'Import…';
  importButton.title = 'Add project files that somebody sent; the project on the screen stays as it is';
  importButton.addEventListener('click', () => importInput.click());
  dialog.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  });
  dialog.addEventListener('drop', async (e) => {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    await importFiles([...e.dataTransfer.files]);
  });
  const actions = document.createElement('div');
  actions.className = 'app-dialog-actions';
  const close = document.createElement('button');
  close.textContent = 'Close';
  close.addEventListener('click', () => dialog.close());
  const saveNew = document.createElement('button');
  saveNew.textContent = 'Save as a new project';
  const save = document.createElement('button');
  save.className = 'primary';

  const row = (project: StoredProject, current: string | null, removable: boolean): HTMLElement => {
    const element = document.createElement('div');
    element.className = `projects-row${project.id === current ? ' current' : ''}`;
    const name = document.createElement('div');
    name.className = 'projects-name';
    const heading = document.createElement('strong');
    heading.textContent = project.title || 'Untitled panel';
    const detail = document.createElement('small');
    detail.append(...detailOf(project, project.id === current));
    name.append(heading, detail);
    const open = document.createElement('button');
    open.textContent = 'Open';
    open.addEventListener('click', async () => {
      await host.open(project);
      dialog.close();
    });
    const exportButton = document.createElement('button');
    exportButton.textContent = 'Export';
    exportButton.title = 'Download this project as a file, to send to somebody';
    exportButton.addEventListener('click', () => host.export(project));
    const compareButton = document.createElement('button');
    compareButton.textContent = 'Compare';
    compareButton.title = 'See what differs between this project and the one on the screen';
    compareButton.addEventListener('click', () => host.compare(project));
    element.append(name, open, compareButton, exportButton);
    if (removable) {
      const remove = document.createElement('button');
      remove.textContent = 'Delete';
      remove.addEventListener('click', async () => {
        if (await host.remove(project)) await refresh();
      });
      element.append(remove);
    }
    return element;
  };

  const refresh = async () => {
    const all = await host.list();
    const projects = newestFirst(savedProjects(all));
    const earlier = snapshotsOf(all);
    const current = host.currentId();
    save.textContent = current && projects.some((p) => p.id === current) ? 'Save over the open one' : 'Save the project';
    list.replaceChildren();
    if (projects.length === 0) list.append(Object.assign(document.createElement('p'), { className: 'tables-empty', textContent: 'Nothing is saved here yet.' }));
    for (const project of projects) list.append(row(project, current, true));
    if (earlier.length > 0) {
      const heading = document.createElement('h3');
      heading.className = 'projects-earlier';
      heading.textContent = 'Earlier states';
      const note = document.createElement('p');
      note.className = 'projects-help';
      note.textContent = 'Kept by the application every few minutes and before a project is replaced; the oldest ones go.';
      list.append(heading, note);
      for (const project of earlier) list.append(row(project, null, false));
    }
  };
  save.addEventListener('click', async () => {
    await host.saveCurrent();
    await refresh();
  });
  saveNew.addEventListener('click', async () => {
    await host.saveAsNew();
    await refresh();
  });
  actions.append(close, importButton, saveNew, save);
  dialog.append(title, help, list, result, importInput, actions);
  dialog.addEventListener('close', () => dialog.remove());
  await refresh();
  document.body.append(dialog);
  dialog.showModal();
  // A list that scrolls is the first thing a browser may focus, and its focus ring is no use here.
  close.focus();
}
