/** Asks for one line of text in an HTML modal; resolves with it, or null if cancelled. */
export function askForText(title: string, label: string, initial = '', confirmLabel = 'OK'): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'app-dialog';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const field = document.createElement('label');
    field.className = 'text-dialog-field';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = initial;
    input.maxLength = 60;
    field.append(`${label} `, input);
    const actions = document.createElement('div');
    actions.className = 'app-dialog-actions';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    const confirm = document.createElement('button');
    confirm.textContent = confirmLabel;
    confirm.className = 'primary';
    let answer: string | null = null;
    const accept = () => {
      answer = input.value;
      dialog.close();
    };
    confirm.addEventListener('click', accept);
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      // Without this the same Enter reaches the button that had the focus before, and presses it.
      e.preventDefault();
      accept();
    });
    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(answer);
    });
    actions.append(cancel, confirm);
    dialog.append(heading, field, actions);
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
    input.select();
  });
}
