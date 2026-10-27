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
}

const counts = (p: StoredProject): string => {
  const { placements } = p.file.project.panel;
  const { wires, nodes } = p.file.project.schematic;
  return `${placements.length} module${placements.length === 1 ? '' : 's'}, ${nodes.length} node${nodes.length === 1 ? '' : 's'}, ${wires.length} wire${wires.length === 1 ? '' : 's'}`;
};

/** The projects kept in this browser: save the one on the screen, open another, take one away. */
export async function openProjectsDialog(host: ProjectsHost): Promise<void> {
  const dialog = document.createElement('dialog');
  dialog.className = 'app-dialog projects-dialog';
  const title = document.createElement('h2');
  title.textContent = 'Projects in this browser';
  const help = document.createElement('p');
  help.className = 'projects-help';
  help.textContent = 'The project on the screen is also kept by itself, as one, for when the page is opened again; the ones here are kept until you take them away.';
  const list = document.createElement('div');
  list.className = 'projects-list';
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
    detail.textContent = `${new Date(project.savedAt).toLocaleString()} · ${counts(project)}${project.id === current ? ' · open now' : ''}`;
    name.append(heading, detail);
    const open = document.createElement('button');
    open.textContent = 'Open';
    open.addEventListener('click', async () => {
      await host.open(project);
      dialog.close();
    });
    element.append(name, open);
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
  actions.append(close, saveNew, save);
  dialog.append(title, help, list, actions);
  dialog.addEventListener('close', () => dialog.remove());
  await refresh();
  document.body.append(dialog);
  dialog.showModal();
}
