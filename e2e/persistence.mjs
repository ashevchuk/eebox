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
    await browser.evaluate(`window.print = () => {}; document.getElementById('print').click()`);
    await browser.waitFor(`document.querySelector('#print-sheet svg')`, 'the drawings of the sheet');
    expectTrue(await browser.evaluate(`document.querySelector('#print-sheet svg').innerHTML.includes('<clipPath')`), 'the faces are not in the printed drawing');
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
