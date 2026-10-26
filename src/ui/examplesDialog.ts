import type { Example } from '../examples';

/** An HTML dialog to pick one of the bundled example projects; resolves with it, or null on cancel. */
export function chooseExample(examples: readonly Example[]): Promise<Example | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'app-dialog examples-dialog';
    const title = document.createElement('h2');
    title.textContent = 'Examples';
    const list = document.createElement('div');
    list.className = 'examples-list';
    let chosen: Example | null = null;
    for (const example of examples) {
      const item = document.createElement('button');
      item.className = 'example-item';
      const name = document.createElement('strong');
      name.textContent = example.title;
      const description = document.createElement('span');
      description.textContent = example.description;
      item.append(name, description);
      item.addEventListener('click', () => {
        chosen = example;
        dialog.close();
      });
      list.append(item);
    }
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => dialog.close());
    const actions = document.createElement('div');
    actions.className = 'app-dialog-actions';
    actions.append(cancel);
    dialog.append(title, list, actions);
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(chosen);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}
