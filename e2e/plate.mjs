/**
 * Devices fixed to the mounting plate and cable ducts, in a real browser with real mouse and keys: a device
 * of the designer is dropped away from every rail, dragged, nudged and copied, and a duct is drawn, moved and
 * deleted. Run `npm run build:dist-file` first.
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
const expectTrue = (value, what) => {
  if (!value) throw new Error(what);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const saved = () =>
  browser.evaluate(`(async () => { await new Promise((r) => setTimeout(r, 900)); const f = JSON.parse(localStorage.getItem('eebox:autosave')); return f.project.panel; })()`);
const canvasBox = () => browser.evaluate(`(() => { const r = document.getElementById('stage').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`);
const press = (code, modifiers = 0) => browser.key(code, code, 0, '', modifiers);
const inspectorText = () => browser.evaluate(`document.getElementById('inspector').innerText`);

try {
  browser = await launch();
  await browser.goto(page);
  await browser.evaluate(`localStorage.setItem('eebox:tour-done', 'true')`);
  await browser.goto(page);
  await browser.resize(1516, 784);
  await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the palette');

  await step('a soft starter is made in the designer from its template and saved into My modules', async () => {
    await browser.evaluate(`document.getElementById('new-module').click()`);
    await browser.waitFor(`document.querySelector('.designer-dialog[open]')`, 'the designer');
    await browser.evaluate(`(() => { const s = document.querySelector('.designer-dialog select'); s.value = 'soft-starter'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await browser.evaluate(`(() => {
      const row = [...document.querySelectorAll('.designer-fields .inspector-field')].find((r) => r.innerText.startsWith('Name'));
      const input = row.querySelector('input'); input.value = 'Plate soft starter'; input.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('.designer-dialog button.primary').click();
    })()`);
    await browser.waitFor(`document.querySelector('.designer-dialog .editor-status')?.textContent.includes('Saved')`, 'the module to be saved');
    await browser.evaluate(`[...document.querySelectorAll('.designer-dialog header button')].find((b) => b.textContent === 'Close').click()`);
    await browser.evaluate(`(() => { const s = document.getElementById('palette-search'); s.value = 'plate soft'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await browser.waitFor(`document.querySelector('#palette .module')?.textContent.includes('Plate soft starter')`, 'the module in the palette');
  });

  let dropped;
  await step('dropped away from every rail, a plate device stands where it is dropped, with no row', async () => {
    const [left, top, width, height] = await canvasBox();
    const at = await browser.evaluate(`(() => { const r = document.querySelector('#palette .module').getBoundingClientRect(); return [r.x + 20, r.y + r.height / 2]; })()`);
    const to = [left + width * 0.7, top + height * 0.75];
    await browser.mouse('mousePressed', at[0], at[1]);
    await browser.mouse('mouseMoved', at[0] + 60, at[1] + 10);
    await browser.mouse('mouseMoved', to[0], to[1]);
    await browser.mouse('mouseMoved', to[0] + 1, to[1] + 1);
    await browser.mouse('mouseReleased', to[0] + 1, to[1] + 1);
    await browser.waitFor(`document.getElementById('inspector').innerText.includes('Left edge')`, 'the plate device in the inspector');
    const panel = await saved();
    dropped = panel.placements.at(-1);
    expectTrue(dropped && typeof dropped.x === 'number' && typeof dropped.y === 'number' && dropped.rail === undefined && dropped.slot === undefined, `the device has no free position: ${JSON.stringify(dropped)}`);
    expectTrue(!(await inspectorText()).includes('Row'), 'the inspector shows a row for a device on the plate');
    expectTrue(JSON.stringify(Object.keys(dropped).sort()) === JSON.stringify(['id', 'module', 'x', 'y']), `the device carries more than a place: ${JSON.stringify(dropped)}`);
  });

  await step('dragging the device with the mouse moves it on the plate, and one step is one undo', async () => {
    const [left, top, width, height] = await canvasBox();
    const grabAt = [left + width * 0.7 + 1, top + height * 0.75 + 1];
    await browser.mouse('mousePressed', grabAt[0], grabAt[1]);
    await browser.mouse('mouseMoved', grabAt[0] + 20, grabAt[1] + 20);
    await browser.mouse('mouseMoved', grabAt[0] + 60, grabAt[1] - 30);
    await browser.mouse('mouseReleased', grabAt[0] + 60, grabAt[1] - 30);
    const moved = (await saved()).placements.find((p) => p.id === dropped.id);
    expectTrue(moved.x > dropped.x && moved.y < dropped.y, `the device did not follow the pointer: ${JSON.stringify([dropped, moved])}`);
    await browser.evaluate(`document.getElementById('undo').click()`);
    const undone = (await saved()).placements.find((p) => p.id === dropped.id);
    expectTrue(undone.x === dropped.x && undone.y === dropped.y, 'Undo did not put the device back in one step');
    await browser.evaluate(`document.getElementById('redo').click()`);
  });

  await step('the arrow keys nudge it by a millimetre, ten with Shift', async () => {
    const before = (await saved()).placements.find((p) => p.id === dropped.id);
    await press('ArrowRight');
    await press('ArrowDown', 8);
    const after = (await saved()).placements.find((p) => p.id === dropped.id);
    expectTrue(Math.abs(after.x - before.x - 1) < 0.01 && Math.abs(after.y - before.y - 10) < 0.01, `steps were ${after.x - before.x}, ${after.y - before.y}`);
  });

  let ductId;
  await step('the duct tool draws a duct between two corners and stays on for the next, until Escape', async () => {
    const [left, top, width, height] = await canvasBox();
    await browser.evaluate(`document.getElementById('duct-tool').click()`);
    const a = [left + width * 0.2, top + height * 0.55];
    const b = [left + width * 0.55, top + height * 0.6];
    await browser.mouse('mousePressed', a[0], a[1]);
    await browser.mouse('mouseMoved', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    await browser.mouse('mouseMoved', b[0], b[1]);
    await browser.mouse('mouseReleased', b[0], b[1]);
    const panel = await saved();
    expectTrue(panel.ducts?.length === 1, `no duct was made: ${JSON.stringify(panel.ducts)}`);
    ductId = panel.ducts[0].id;
    expectTrue(panel.ducts[0].widthMm > panel.ducts[0].heightMm, 'the duct is not wider than tall');
    expectTrue(await browser.evaluate(`document.getElementById('duct-tool').classList.contains('active')`), 'the tool went off after one duct');
    await press('Escape');
    expectTrue(!(await browser.evaluate(`document.getElementById('duct-tool').classList.contains('active')`)), 'Escape did not turn the tool off');
  });

  await step('a duct is selected and shown in the inspector, edited in its fields, moved by a key and by the mouse', async () => {
    const [left, top, width, height] = await canvasBox();
    await browser.mouse('mousePressed', left + width * 0.37, top + height * 0.575);
    await browser.mouse('mouseReleased', left + width * 0.37, top + height * 0.575);
    await browser.waitFor(`document.getElementById('inspector').innerText.includes('Cable duct')`, 'the duct in the inspector');
    await browser.evaluate(`(() => {
      const row = [...document.querySelectorAll('#inspector .inspector-field')].find((r) => r.innerText.startsWith('Label'));
      const input = row.querySelector('input'); input.value = 'Power'; input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    const labelled = (await saved()).ducts[0];
    expectTrue(labelled.label === 'Power', 'the label was not saved');
    await press('ArrowLeft');
    const nudged = (await saved()).ducts[0];
    expectTrue(Math.abs(labelled.x - nudged.x - 1) < 0.01 || nudged.x === 0, 'the arrow key did not move the duct by a millimetre');
    await browser.mouse('mousePressed', left + width * 0.37, top + height * 0.575);
    await browser.mouse('mouseMoved', left + width * 0.37 + 15, top + height * 0.575 + 15);
    await browser.mouse('mouseMoved', left + width * 0.37 + 40, top + height * 0.575 + 40);
    await browser.mouse('mouseReleased', left + width * 0.37 + 40, top + height * 0.575 + 40);
    const dragged = (await saved()).ducts[0];
    expectTrue(dragged.x > nudged.x && dragged.y > nudged.y, `the duct did not follow the pointer: ${JSON.stringify([nudged, dragged])}`);
  });

  await step('everything is copied and pasted a little aside, and deleted from the keyboard', async () => {
    await press('KeyA', 2);
    await browser.waitFor(`document.getElementById('inspector').innerText.includes('items selected')`, 'all selected');
    await press('KeyC', 2);
    await press('KeyV', 2);
    await browser.waitFor(`true`, 'a beat');
    const panel = await saved();
    expectTrue(panel.ducts.length === 2, `ducts after paste: ${panel.ducts.length}`);
    expectTrue(panel.placements.filter((p) => p.x !== undefined).length === 2, 'the device was not copied');
    await press('Delete');
    const gone = await saved();
    expectTrue(gone.ducts?.length === 1 && gone.placements.length === 1, `delete should take the copies and leave the originals: ${JSON.stringify([gone.ducts, gone.placements])}`);
  });

  await step('a device dropped on the plate and a duct survive a reload', async () => {
    const before = await saved();
    await browser.goto(page);
    await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the palette after reload');
    const after = await saved();
    expectTrue(JSON.stringify(after.ducts) === JSON.stringify(before.ducts) && JSON.stringify(after.placements) === JSON.stringify(before.placements), 'the plate things did not come back');
  });

  expectTrue(browser.problems.length === 0, `the page raised errors: ${JSON.stringify(browser.problems)}`);
} finally {
  await browser?.close();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} step(s) failed`);
  process.exit(1);
}
console.log('\nplate test passed');
