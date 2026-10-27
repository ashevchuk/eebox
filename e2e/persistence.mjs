/**
 * Everything that has to survive a reload, in a real browser: what is made in one session is checked in
 * the next, which is the same page opened again with the same storage. Run `npm run build:dist-file` first.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from './browser.mjs';

const page = pathToFileURL(resolve('dist-file/index.html')).href;
const failures = [];
let browser;

async function step(name, run) {
  try {
    await run();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.log(`  FAIL ${name}\n       ${error.message}`);
  }
}
const expectEqual = (actual, wanted, what) => {
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${what}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`);
};
const expectTrue = (value, what) => {
  if (!value) throw new Error(what);
};
const clickButton = (text) =>
  browser.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().replace(/\\s*\\u25BE$/, '') === ${JSON.stringify(text)}); if (!b) throw new Error('no button ' + ${JSON.stringify(text)}); b.click(); })()`);
const status = () => browser.evaluate(`document.getElementById('status').textContent`);

/** Runs the download code of a button and gives back what it would have saved as a file. */
const downloaded = (id) =>
  browser.evaluate(`(async () => {
    let blob = null; const create = URL.createObjectURL; URL.createObjectURL = (b) => { blob = b; return create(b); };
    const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {};
    document.getElementById(${JSON.stringify(id)}).click(); await new Promise((r) => setTimeout(r, 500));
    HTMLAnchorElement.prototype.click = click; URL.createObjectURL = create;
    return blob ? await blob.text() : null;
  })()`);

const openFile = (text, name) =>
  browser.evaluate(`(async () => {
    const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)}));
    const input = document.getElementById('open-project'); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click();
  })()`);

const inspectorField = (label) =>
  browser.evaluate(`[...document.querySelectorAll('#inspector .inspector-field')].find((r) => r.querySelector('label')?.textContent === ${JSON.stringify(label)})?.querySelector('input,select')?.value`);

try {
  browser = await launch();
  await browser.goto(page);
  await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the bundled library in the palette');

  await browser.evaluate(`localStorage.setItem('eebox:tour-done', 'yes'); document.getElementById('tour').hidden = true;`);

  /* First session: make things */

  await step('a project from the examples is opened, renamed, and the autosave keeps the new name', async () => {
    await clickButton('File');
    await browser.evaluate(`document.getElementById('open-example').click()`);
    await browser.waitFor(`document.querySelector('.examples-dialog[open]')`, 'the examples dialog');
    await browser.evaluate(`[...document.querySelectorAll('.example-item')].find((b) => b.textContent.startsWith('TN-C-S')).click()`);
    await browser.evaluate(`(async () => { await new Promise((r) => setTimeout(r, 300)); [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click(); })()`);
    await browser.waitFor(`document.getElementById('status').textContent.includes('loaded')`, 'the example to load');
    await browser.evaluate(`(() => { const i = [...document.querySelectorAll('#inspector .inspector-field')].find((r) => r.querySelector('label')?.textContent === 'Title').querySelector('input'); i.value = 'Persist test'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await browser.waitFor(`(localStorage.getItem('eebox:autosave') ?? '').includes('Persist test')`, 'the autosave to hold the new title');
  });

  await step('the colours and a cable value are stored when they are chosen', async () => {
    await clickButton('File');
    await browser.evaluate(`document.getElementById('colour-scheme').click()`);
    await browser.waitFor(`document.querySelector('dialog[open] .colours-table')`, 'the colours dialog');
    await browser.evaluate(`(() => { const s = document.querySelector('dialog[open] select'); s.value = 'eu'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await browser.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Save').click()`);
    await browser.waitFor(`JSON.parse(localStorage.getItem('eebox:colour-scheme') ?? '{}').scheme === 'eu'`, 'the scheme to be stored');
    await clickButton('File');
    await browser.evaluate(`document.getElementById('cable-settings').click()`);
    await browser.waitFor(`document.querySelector('dialog[open] .settings-table')`, 'the cable settings');
    await browser.evaluate(`(() => { const i = document.querySelectorAll('dialog[open] .settings-table input')[10]; i.value = '29'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await browser.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Save').click()`);
    await browser.waitFor(`localStorage.getItem('eebox:cable-settings') !== null`, 'the cable settings to be stored');
  });

  await step('a module with a drawn and an imported face is saved into My modules', async () => {
    await browser.evaluate(`document.getElementById('new-module').click()`);
    await browser.waitFor(`[...document.querySelectorAll('.designer-dialog[open] .designer-modes button')].some((b) => b.textContent === 'Face')`, 'the designer');
    await browser.evaluate(`(() => {
      const fields = () => [...document.querySelectorAll('.designer-dialog[open] .designer-fields .inspector-field')];
      const set = (row, value) => { const i = row.querySelector('input'); i.value = value; i.dispatchEvent(new Event('change', { bubbles: true })); };
      set(fields().find((r) => r.innerText.startsWith('Name')), 'Persist face');
      set(fields().find((r) => r.innerText.startsWith('Width') && !r.innerText.startsWith('Width, mm')), '3');
      [...document.querySelectorAll('.designer-dialog[open] .designer-modes button')].find((b) => b.textContent === 'Face').click();
    })()`);
    await browser.waitFor(`document.querySelector('.designer-dialog[open] .face-stage svg')`, 'the face');
    const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect width="20" height="5" fill="#cc0000"/><path d="M2 18 A8 8 0 0 1 18 18 Z" fill="#003399"/><text x="10" y="12" font-size="4" text-anchor="middle" fill="#000000">PF</text></svg>';
    await browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] .face-stage .designer-toolbar button')].find((b) => b.textContent === 'Import SVG…').click()`);
    await browser.waitFor(`document.querySelector('.designer-dialog[open] dialog[open] textarea')`, 'the import dialog');
    await browser.evaluate(`(() => { const t = document.querySelector('.designer-dialog[open] dialog[open] textarea'); t.value = ${JSON.stringify(svgText)}; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await browser.waitFor(`!document.querySelector('.designer-dialog[open] dialog[open] button.primary').disabled`, 'the import to be ready');
    await browser.evaluate(`document.querySelector('.designer-dialog[open] dialog[open] button.primary').click()`);
    await browser.waitFor(`document.querySelectorAll('.designer-dialog[open] .face-layer').length === 3`, 'the imported shapes');
    await browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] header button')].find((b) => b.textContent === 'Undo').click()`);
    await browser.waitFor(`document.querySelectorAll('.designer-dialog[open] .face-layer').length === 0`, 'the import to be undone');
    await browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] header button')].find((b) => b.textContent === 'Redo').click()`);
    await browser.waitFor(`document.querySelectorAll('.designer-dialog[open] .face-layer').length === 3`, 'the import to be redone');
    await browser.evaluate(`document.querySelector('.designer-dialog[open] button.primary').click()`);
    await browser.waitFor(`document.querySelector('.designer-dialog[open] .editor-status')?.textContent.includes('Saved')`, 'the module to be saved');
    await browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] header button')].find((b) => b.textContent === 'Close').click()`);
    await browser.waitFor(`!document.querySelector('.designer-dialog[open]')`, 'the designer to close');
  });

  await step('the page raised no errors in the first session', async () => {
    expectEqual(browser.problems, [], 'errors in the page');
  });

  /* Second session: the same page opened again */

  await browser.goto(page);
  await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the library after the reload');
  await browser.waitFor(`document.getElementById('status') !== null && document.querySelector('#inspector')`, 'the page after the reload');
  await new Promise((r) => setTimeout(r, 800));

  await step('after a reload the project, with its title, is where it was left', async () => {
    expectEqual(await inspectorField('Title'), 'Persist test', 'the title of the panel');
    expectEqual(await browser.evaluate(`document.getElementById('inspector').innerText.includes('8 modules') || document.getElementById('inspector').innerText.includes('modules')`), true, 'the contents of the panel');
  });

  await step('after a reload the earthing system and its conductors are on the source', async () => {
    await clickButton('Schematic');
    await browser.evaluate(`document.getElementById('fit')?.click()`);
    const stored = await browser.evaluate(`JSON.parse(localStorage.getItem('eebox:autosave')).project?.project?.schematic?.nodes?.find((n) => n.kind === 'source') ?? JSON.parse(localStorage.getItem('eebox:autosave')).project?.schematic?.nodes?.find((n) => n.kind === 'source')`);
    expectEqual([stored?.earthing, stored?.conductors], ['TN-C-S', ['L1', 'L2', 'L3', 'PEN']], 'the source in the autosave');
    await clickButton('Panel');
  });

  await step('after a reload the faces of the modules are in the project and are drawn', async () => {
    const text = await downloaded('export-svg');
    expectTrue(text?.includes("font-family=\"&apos;eebox-sans&apos;") || text?.includes('eebox-sans'), 'the exported drawing does not use the bundled font');
    expectTrue((text.match(/<path /g) ?? []).length > 40, 'the faces are not in the exported drawing');
    expectTrue(/<clipPath/.test(text), 'the faces are not clipped to the modules');
  });

  await step('after a reload the colours are the ones chosen and the cable value is still changed', async () => {
    expectEqual(await browser.evaluate(`JSON.parse(localStorage.getItem('eebox:colour-scheme')).scheme`), 'eu', 'the scheme');
    await clickButton('File');
    await browser.evaluate(`document.getElementById('colour-scheme').click()`);
    await browser.waitFor(`document.querySelector('dialog[open] .colours-table')`, 'the colours dialog');
    expectEqual(await browser.evaluate(`document.querySelector('dialog[open] select').value`), 'eu', 'the scheme shown');
    await browser.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Cancel').click()`);
    await clickButton('File');
    await browser.evaluate(`document.getElementById('cable-settings').click()`);
    await browser.waitFor(`document.querySelector('dialog[open] .settings-table')`, 'the cable settings');
    expectEqual(await browser.evaluate(`document.querySelectorAll('dialog[open] .settings-table input')[10].value`), '29', 'the changed cable value');
    await browser.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Cancel').click()`);
  });

  await step('after a reload the module with its face is in My modules, and its drawing opens in the designer', async () => {
    await browser.evaluate(`document.getElementById('palette-search').value = 'persist face'; document.getElementById('palette-search').dispatchEvent(new Event('input', { bubbles: true }))`);
    await browser.waitFor(`document.querySelector('#palette .module')?.textContent.includes('Persist face')`, 'the module in the palette');
    await browser.evaluate(`document.querySelector('#palette .module-action, #palette .module button')?.click()`);
    await browser.waitFor(`document.querySelector('.designer-dialog[open]')`, 'the designer');
    await browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] .designer-modes button')].find((b) => b.textContent === 'Face').click()`);
    await browser.waitFor(`document.querySelectorAll('.designer-dialog[open] .face-layer').length === 3`, 'the three shapes of the face');
    expectEqual(await browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] .face-layer')].map((b) => b.textContent)`), ['1. rect', '2. path', '3. text “PF”'], 'the shapes of the face after the reload');
    await browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] header button')].find((b) => b.textContent === 'Close').click()`);
    await browser.waitFor(`!document.querySelector('.designer-dialog[open]')`, 'the designer to close');
  });

  await step('a project file keeps the faces and the earthing, and opens again without a warning', async () => {
    const text = await downloaded('save-project');
    const file = JSON.parse(text);
    const modules = Object.values(file.modules);
    expectTrue(modules.some((m) => Array.isArray(m.art) && m.art.length > 0), 'no module of the file has a face');
    expectTrue(file.project.schematic.nodes.some((n) => n.earthing === 'TN-C-S'), 'the earthing system is not in the file');
    await openFile(text, 'again.json');
    await browser.waitFor(`document.getElementById('status').textContent.includes('again.json loaded')`, 'the file to load');
    expectTrue(!(await status()).includes('warning'), 'the file opened with warnings');
  });

  await step('a project saved in the browser is listed after a reload, opens, and is taken away', async () => {
    const dialogText = () => browser.evaluate(`document.querySelector('dialog[open].projects-dialog')?.innerText ?? ''`);
    const dialogButton = (text) =>
      browser.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === ${JSON.stringify(text)}).click()`);
    await browser.evaluate(`document.getElementById('open-projects').click()`);
    await browser.waitFor(`document.querySelector('dialog[open].projects-dialog')`, 'the projects dialog');
    expectTrue((await dialogText()).includes('Nothing is saved here yet'), 'the list is not empty at first');
    await dialogButton('Save the project');
    await browser.waitFor(`document.querySelector('.projects-row.current')`, 'the saved project in the list');
    await dialogButton('Close');
    await browser.goto(page);
    await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the page after the reload');
    await browser.evaluate(`document.getElementById('open-projects').click()`);
    await browser.waitFor(`document.querySelector('.projects-row')`, 'the stored project after the reload');
    expectTrue((await dialogText()).includes('Persist test'), 'the stored project has lost its title');
    await dialogButton('Open');
    await browser.evaluate(`new Promise((r) => setTimeout(r, 300)).then(() => [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click())`);
    await browser.waitFor(`document.getElementById('status').textContent.includes('loaded')`, 'the stored project to load');
    expectEqual(await inspectorField('Title'), 'Persist test', 'the title of the opened project');
    await browser.evaluate(`document.getElementById('open-projects').click()`);
    await browser.waitFor(`document.querySelector('.projects-row.current')`, 'the opened project marked as open');
    await dialogButton('Delete');
    await browser.waitFor(`[...document.querySelectorAll('dialog[open]')].pop()?.querySelector('.primary')?.textContent === 'Delete'`, 'the question about deleting');
    await browser.evaluate(`[...document.querySelectorAll('dialog[open]')].pop().querySelector('.primary').click()`);
    await browser.waitFor(`document.querySelector('dialog[open].projects-dialog')?.innerText.includes('Nothing is saved here yet')`, 'the list to be empty');
    await dialogButton('Close');
  });

  await step('a project that a new panel replaces is kept as an earlier state under its own name and comes back from the list', async () => {
    const setTitle = (text) =>
      browser.evaluate(`(() => { const input = [...document.querySelectorAll('#inspector .inspector-field')].find((r) => r.querySelector('label')?.textContent === 'Title').querySelector('input'); input.value = ${JSON.stringify(text)}; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    // A state that no earlier snapshot has, so that the one taken by the replacing panel is the one that is listed first.
    await setTitle('Replaced one');
    await browser.evaluate(`document.getElementById('new-panel').click(); new Promise((r) => setTimeout(r, 300)).then(() => [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click())`);
    await browser.waitFor(`document.querySelector('#inspector .inspector-field input')?.value === ''`, 'the empty panel');
    await browser.evaluate(`document.getElementById('open-projects').click()`);
    await browser.waitFor(`document.querySelector('.projects-earlier')`, 'the earlier states');
    expectEqual(await browser.evaluate(`document.querySelector('.projects-row strong').textContent`), 'Replaced one', 'the name of the earlier state, which is the name of the project that was replaced');
    await browser.evaluate(`document.querySelector('.projects-row button').click()`);
    await browser.waitFor(`document.getElementById('status').textContent.includes('loaded')`, 'the earlier state to load');
    expectEqual(await inspectorField('Title'), 'Replaced one', 'the title of the earlier state');
    await setTitle('Persist test');
  });

  await step('a backup holds the project, the libraries and the settings, and puts them back; garbage is refused', async () => {
    const text = await downloaded('backup-all');
    const backup = JSON.parse(text);
    expectEqual(backup.format, 'eebox-workspace', 'the format of the backup');
    expectEqual(backup.current.project.panel.title, 'Persist test', 'the project on the screen in the backup');
    expectTrue(backup.libraries.some((l) => l.id === 'my-modules'), 'My modules is not in the backup');
    expectTrue(backup.libraries.every((l) => l.id !== 'generic-iec'), 'the bundled library is in the backup');
    expectTrue('eebox:cable-settings' in backup.settings, 'the cable settings are not in the backup');
    const restore = (content, name) =>
      browser.evaluate(`(async () => {
        const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(content)}], ${JSON.stringify(name)}));
        const input = document.getElementById('restore-all'); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 500));
        [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Restore')?.click();
        await new Promise((r) => setTimeout(r, 500));
      })()`);
    await restore('{"format":"eebox-project"}', 'wrong.json');
    expectTrue((await status()).includes('eebox-workspace'), `a wrong file was not refused: ${await status()}`);
    await restore(text, 'backup.json');
    await browser.waitFor(`document.getElementById('status').textContent.includes('backup.json loaded')`, 'the backup to load');
    expectEqual(await inspectorField('Title'), 'Persist test', 'the title after the restore');
  });

  await step('a share link opens the same project in a fresh page', async () => {
    await browser.evaluate(`document.getElementById('share-link').click()`);
    await browser.waitFor(`location.hash.startsWith('#p=')`, 'the link in the address bar');
    const url = await browser.evaluate(`location.href`);
    await browser.goto('about:blank');
    await browser.goto(url);
    await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the page');
    await browser.waitFor(`document.querySelector('dialog[open]')?.innerText.includes('Open the shared project')`, 'the question about the autosaved project');
    await browser.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Open shared project').click()`);
    await browser.waitFor(`document.getElementById('status').textContent.includes('Shared project')`, 'the shared project to load');
    expectEqual(await inspectorField('Title'), 'Persist test', 'the title of the shared project');
  });

  await step('a share link put into the address bar of an open page opens too', async () => {
    await browser.evaluate(`document.getElementById('share-link').click()`);
    await browser.waitFor(`location.hash.startsWith('#p=')`, 'the link in the address bar');
    const hash = await browser.evaluate(`location.hash`);
    await browser.evaluate(`history.replaceState(null, '', location.pathname); document.getElementById('status').textContent = ''`);
    await browser.evaluate(`location.hash = ${JSON.stringify(hash)}`);
    await browser.evaluate(`new Promise((r) => setTimeout(r, 500)).then(() => [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click())`);
    await browser.waitFor(`document.getElementById('status').textContent.includes('Shared project')`, 'the shared project to load');
    expectEqual(await browser.evaluate(`location.hash`), '', 'the address bar after the link was used');
  });

  await step('a PNG of the panel is a real picture with the faces in it', async () => {
    await clickButton('Panel');
    const png = await browser.evaluate(`(async () => {
      let blob = null; const create = URL.createObjectURL; URL.createObjectURL = (b) => { blob = b; return create(b); };
      const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {};
      document.getElementById('export-png').click(); await new Promise((r) => setTimeout(r, 1500));
      HTMLAnchorElement.prototype.click = click; URL.createObjectURL = create;
      if (!blob) return null;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return { type: blob.type, size: bytes.length, signature: [...bytes.slice(0, 8)] };
    })()`);
    expectEqual(png?.signature, [137, 80, 78, 71, 13, 10, 26, 10], 'the signature of a PNG file');
    expectTrue(png.size > 20000, `a picture of ${png.size} bytes is too small to have the modules in it`);
  });

  await step('the print sheet holds the faces too', async () => {
    await browser.evaluate(`window.print = () => {}; document.getElementById('print').click(); new Promise((r) => setTimeout(r, 200)).then(() => [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Print').click())`);
    await browser.waitFor(`document.querySelector('#print-sheet svg')`, 'the drawings of the sheet');
    expectTrue(await browser.evaluate(`document.querySelector('#print-sheet svg').innerHTML.includes('<clipPath')`), 'the faces are not in the printed drawing');
  });

  await step('the print dialog prints only the parts that are ticked, on the paper that is chosen', async () => {
    await browser.evaluate(`window.print = () => {}; document.getElementById('print').click(); new Promise((r) => setTimeout(r, 200)).then(() => {
      const dialog = document.querySelector('dialog[open].print-dialog');
      for (const label of dialog.querySelectorAll('label')) {
        const box = label.querySelector('input');
        if (box && label.textContent.trim() !== 'Panel layout') { box.checked = false; box.dispatchEvent(new Event('change')); }
      }
      const [paper, orientation] = dialog.querySelectorAll('select');
      paper.value = 'A3'; paper.dispatchEvent(new Event('change'));
      orientation.value = 'portrait'; orientation.dispatchEvent(new Event('change'));
      [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Print').click();
    })`);
    await browser.waitFor(`document.querySelectorAll('#print-sheet svg').length === 1`, 'one drawing on the sheet');
    expectEqual(await browser.evaluate(`document.querySelectorAll('#print-sheet h2, #print-sheet table').length`), 0, 'lists on the sheet');
    expectTrue(await browser.evaluate(`[...document.querySelectorAll('head style')].some((s) => s.textContent.includes('A3 portrait'))`), 'the page rule of the chosen paper');
  });

  await step('the export dialog turns the text of a print off and on, apart from the screen', async () => {
    const clickIn = (text) => browser.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === ${JSON.stringify(text)}).click()`);
    const printOnce = async () => {
      await browser.evaluate(`window.print = () => {}; document.getElementById('print').click(); new Promise((r) => setTimeout(r, 200)).then(() => [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Print').click())`);
      await browser.waitFor(`document.querySelectorAll('#print-sheet svg').length >= 1`, 'a drawing on the sheet');
    };
    await browser.evaluate(`document.getElementById('export-text').click()`);
    await browser.waitFor(`document.querySelector('dialog[open].export-text-dialog')`, 'the dialog of the text');
    await clickIn('No text');
    await clickIn('Apply');
    await printOnce();
    expectEqual(await browser.evaluate(`document.querySelectorAll('#print-sheet h1, #print-sheet h2, #print-sheet figcaption').length`), 0, 'headings and captions on the sheet');
    expectEqual(await browser.evaluate(`document.querySelectorAll('#print-sheet svg text').length`), 0, 'text in the drawings');
    expectTrue(await browser.evaluate(`document.getElementById('view-text-options').querySelector('input').checked`), 'the screen lost its text with the export');
    await browser.evaluate(`document.getElementById('export-text').click()`);
    await browser.waitFor(`document.querySelector('dialog[open].export-text-dialog')`, 'the dialog of the text');
    await clickIn('All text');
    await clickIn('Apply');
    await printOnce();
    expectTrue(await browser.evaluate(`document.querySelectorAll('#print-sheet svg text').length > 0 && document.querySelectorAll('#print-sheet figcaption').length > 0`), 'the text did not come back');
  });

  await step('a kind of text turned off in the View menu leaves the screen drawing and is kept', async () => {
    const pixels = () => browser.evaluate(`(() => { const c = document.getElementById('stage'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) n += d[i] + d[i + 1] + d[i + 2]; return n; })()`);
    const before = await pixels();
    await browser.evaluate(`document.getElementById('hide-all-text').click()`);
    await new Promise((r) => setTimeout(r, 300));
    expectTrue((await pixels()) !== before, 'the drawing did not change when the text was hidden');
    expectEqual(await browser.evaluate(`[...document.querySelectorAll('#view-text-options input')].every((i) => !i.checked)`), true, 'the boxes of the View menu');
    await browser.goto(page);
    await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the page after a reload');
    expectEqual(await browser.evaluate(`[...document.querySelectorAll('#view-text-options input')].every((i) => !i.checked)`), true, 'the choice after the reload');
    await browser.evaluate(`document.getElementById('show-all-text').click()`);
  });

  await step('the side panels are dragged to another width, which is kept after a reload', async () => {
    const widths = () => browser.evaluate(`({ sidebar: Math.round(document.getElementById('sidebar').getBoundingClientRect().width), inspector: Math.round(document.getElementById('inspector').getBoundingClientRect().width) })`);
    const drag = async (id, dx) => {
      const [x, y] = await browser.evaluate(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + 200]; })()`);
      await browser.mouse('mousePressed', x, y);
      await browser.mouse('mouseMoved', x + dx / 2, y);
      await browser.mouse('mouseMoved', x + dx, y);
      await browser.mouse('mouseReleased', x + dx, y);
    };
    await browser.evaluate(`document.body.classList.remove('hide-sidebar', 'hide-inspector')`);
    const before = await widths();
    await drag('sidebar-resizer', 80);
    await drag('inspector-resizer', -60);
    const after = await widths();
    expectTrue(after.sidebar >= before.sidebar + 70, `the library panel is ${after.sidebar} px, was ${before.sidebar}`);
    expectTrue(after.inspector >= before.inspector + 50, `the inspector is ${after.inspector} px, was ${before.inspector}`);
    await browser.goto(page);
    await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the page after a reload');
    await browser.evaluate(`document.body.classList.remove('hide-sidebar', 'hide-inspector')`);
    expectEqual(await widths(), after, 'the widths after the reload');
    await browser.evaluate(`document.getElementById('sidebar-resizer').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); document.getElementById('inspector-resizer').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    expectEqual(await widths(), { sidebar: 240, inspector: 270 }, 'the widths after a double click');
  });

  await step('a selection is kept as a snippet, survives a reload and is put on an empty panel', async () => {
    const clickIn = (text) => browser.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === ${JSON.stringify(text)}).click()`);
    await browser.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Panel').click()`);
    await browser.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', ctrlKey: true, bubbles: true }))`);
    await browser.evaluate(`(() => { const b = [...document.querySelectorAll('#snippets button')].find((x) => x.textContent.startsWith('Save selection')); b.focus(); b.click(); })()`);
    await browser.waitFor(`document.querySelector('dialog[open] input')`, 'the dialog for the name');
    await browser.evaluate(`document.querySelector('dialog[open] input').value = 'Whole panel'`);
    await browser.key('Enter', 'Enter', 13, '\r');
    await browser.waitFor(`document.querySelectorAll('#snippets .snippet').length === 1`, 'the snippet in the list');
    await new Promise((r) => setTimeout(r, 400));
    expectEqual(await browser.evaluate(`document.querySelector('dialog[open]') === null`), true, 'a dialog was open again after Enter saved the snippet');
    await browser.goto(page);
    await browser.waitFor(`document.querySelectorAll('#snippets .snippet').length === 1`, 'the snippet after a reload');
    expectTrue((await browser.evaluate(`document.querySelector('#snippets .snippet-name').textContent`)).startsWith('Whole panel'), 'the name of the snippet');
    await browser.evaluate(`const select = document.getElementById('enclosure'); select.value = [...select.options].find((o) => o.value.endsWith('enc-2x24')).value; select.dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('new-panel').click(); new Promise((r) => setTimeout(r, 300)).then(() => [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click())`);
    await browser.waitFor(`/0 modules/.test(document.getElementById('inspector-content').innerText)`, 'the empty panel');
    await browser.evaluate(`[...document.querySelectorAll('#snippets button')].find((b) => b.textContent === 'Insert').click()`);
    await browser.waitFor(`document.getElementById('status').textContent.includes('put on the panel')`, 'the snippet on the panel');
    const backup = JSON.parse(await downloaded('backup-all'));
    expectEqual(backup.snippets.length, 1, 'the snippets in the backup');
  });

  await step('Ctrl+F finds a module by its label and selects it, F zooms to it, and the minimap draws and moves the view', async () => {
    const stagePixels = () => browser.evaluate(`(() => { const c = document.getElementById('stage'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0; return h; })()`);
    const key = (code, ctrl) => browser.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(code.slice(3).toLowerCase())}, code: ${JSON.stringify(code)}, ctrlKey: ${ctrl}, bubbles: true }))`);
    await key('KeyF', true);
    await browser.waitFor(`!document.getElementById('search').hidden`, 'the search box');
    await browser.evaluate(`const input = document.querySelector('#search input'); input.value = 'p1'; input.dispatchEvent(new Event('input', { bubbles: true }))`);
    await browser.waitFor(`document.querySelectorAll('#search .search-result').length >= 1`, 'a result');
    await browser.evaluate(`document.querySelector('#search input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    await browser.waitFor(`document.getElementById('search').hidden`, 'the search box to close');
    const selectedId = () => browser.evaluate(`/\\bp1\\b/.test(document.getElementById('inspector-content').innerText)`);
    expectTrue(await selectedId(), 'the found module is not selected');
    await browser.evaluate(`document.getElementById('fit').click()`);
    await new Promise((r) => setTimeout(r, 300));
    const before = await stagePixels();
    await key('KeyF', false);
    await new Promise((r) => setTimeout(r, 300));
    expectTrue((await stagePixels()) !== before, 'F did not change the view');
    expectTrue(await selectedId(), 'F lost the selection');

    const minimap = () => browser.evaluate(`(() => { const c = document.getElementById('minimap'); const r = c.getBoundingClientRect(); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 120) lit++; return { hidden: c.hidden, lit, x: r.x + r.width * 0.15, y: r.y + r.height * 0.25 }; })()`);
    const map = await minimap();
    expectTrue(!map.hidden && map.lit > 20, `the minimap shows nothing (${map.lit} bright pixels)`);
    const seen = await stagePixels();
    await browser.mouse('mousePressed', map.x, map.y);
    await browser.mouse('mouseReleased', map.x, map.y);
    await new Promise((r) => setTimeout(r, 300));
    expectTrue((await stagePixels()) !== seen, 'a click on the minimap did not move the view');
    await browser.evaluate(`document.getElementById('view-minimap').click()`);
    expectEqual((await minimap()).hidden, true, 'the minimap after it was turned off');
    await browser.evaluate(`document.getElementById('view-minimap').click()`);
  });

  await step('the Modules menu packs the selected modules and copies a row', async () => {
    const placements = () => browser.evaluate(`(() => JSON.parse(localStorage.getItem('eebox:autosave')).project.panel)()`);
    await browser.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Panel').click()`);
    await browser.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', ctrlKey: true, bubbles: true }))`);
    await browser.evaluate(`document.getElementById('row-start').click()`);
    await new Promise((r) => setTimeout(r, 900));
    const packed = await placements();
    const first = packed.placements.filter((p) => p.rail === 0).map((p) => p.slot).sort((a, b) => a - b);
    expectEqual(first[0], 0, 'the first module of the row after To the start');
    const rowsBefore = packed.railLengthsUnits.length;
    await browser.evaluate(`document.getElementById('duplicate-row').click()`);
    await new Promise((r) => setTimeout(r, 900));
    const copied = await placements();
    expectEqual(copied.railLengthsUnits.length, rowsBefore + 1, 'the rows after Duplicate row');
    expectTrue(copied.placements.length > packed.placements.length, 'no modules were copied with the row');
    await browser.evaluate(`document.getElementById('undo')?.click() ?? [...document.querySelectorAll('button')].find((b) => b.textContent === 'Undo').click()`);
  });

  await step('the page raised no errors in the second session', async () => {
    expectEqual(browser.problems, [], 'errors in the page');
  });
} finally {
  await browser?.close();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} step(s) failed:\n${failures.map((f) => ` - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('\npersistence test passed');
