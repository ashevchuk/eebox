/**
 * Narrow bars with a column of terminals, in a real browser: one is dragged from the library onto a horizontal rail, the
 * inspector names its sides right and left, and the module designer draws the terminals in a column, puts them in a row
 * across the width when the layout field says so and back into a column. Run `npm run build:dist-file` first.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { launch } from './browser.mjs';

const page = pathToFileURL(resolve('dist-file/index.html')).href;
const example = readFileSync(resolve('examples/house-panel.json'), 'utf8');
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
  browser.evaluate(`(async () => { await new Promise((r) => setTimeout(r, 900)); return JSON.parse(localStorage.getItem('eebox:autosave')).project.panel; })()`);
const inspectorLine = (label) =>
  browser.evaluate(`(() => { const r = [...document.querySelectorAll('#inspector .inspector-field')].find((x) => x.querySelector('label')?.textContent === ${JSON.stringify(label)}); return r ? r.innerText.replace(/\\n/g, ' ').trim() : null; })()`);
const pins = () => browser.evaluate(`[...document.querySelectorAll('dialog[open] .designer-pin')].map((c) => [Math.round(+c.getAttribute('cx')), Math.round(+c.getAttribute('cy'))])`);
const setLayout = async (value) => {
  await browser.evaluate(`(() => { const r = [...document.querySelectorAll('dialog[open] .inspector-field')].find((x) => x.querySelector('label')?.textContent === 'Terminal layout'); const s = r.querySelector('select'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await wait(500);
};
const distinct = (points, axis) => new Set(points.map((p) => p[axis])).size;

try {
  browser = await launch();
  await browser.goto(page);
  await browser.evaluate(`localStorage.setItem('eebox:tour-done', 'yes')`);
  await browser.goto(page);
  await browser.resize(1516, 784);
  await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the palette');
  await browser.evaluate(`(async () => {
    const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(example)}], 'house.json'));
    const input = document.getElementById('open-project'); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click();
  })()`);
  await browser.waitFor(`document.getElementById('status').textContent.includes('loaded')`, 'the project to load');
  await browser.evaluate(`document.getElementById('fit').click()`);
  await wait(500);

  await step('a narrow bar is dragged from the library onto a horizontal rail and stands there, 0.7 unit wide', async () => {
    await browser.evaluate(`(() => { const s = document.getElementById('palette-search'); s.value = 'neutral bar 16 terminals, right'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await wait(450);
    const from = await browser.evaluate(`(() => { const r = document.querySelector('#palette .module').getBoundingClientRect(); return [r.x + 20, r.y + r.height / 2]; })()`);
    const to = [760, 520];
    await browser.mouse('mousePressed', from[0], from[1]);
    await browser.mouse('mouseMoved', from[0] + 60, from[1] + 10);
    await browser.mouse('mouseMoved', to[0] - 4, to[1] - 4);
    await browser.mouse('mouseMoved', to[0], to[1]);
    await wait(150);
    await browser.mouse('mouseReleased', to[0], to[1]);
    await wait(400);
    const placed = (await saved()).placements.at(-1);
    expectTrue(placed.module.moduleId === 'n-side-16-right' && placed.rail === 1, `the bar is not on the horizontal row: ${JSON.stringify(placed)}`);
    expectTrue((await inspectorLine('Width'))?.includes('0.7 units'), `the bar is not narrow: ${await inspectorLine('Width')}`);
  });

  await step('the inspector names its sides right and left, and Check stays quiet', async () => {
    const line = await inspectorLine('Terminals');
    expectTrue(line === 'Terminals right 16 · no left', `the terminals are described as: ${line}`);
    expectTrue(((await browser.evaluate(`document.getElementById('check').dataset.count ?? ''`)) === ''), 'Check found something');
  });

  await step('the module designer draws its 16 terminals in one column', async () => {
    await browser.evaluate(`[...document.querySelectorAll('#inspector button')].find((x) => /Edit module/.test(x.textContent)).click()`);
    await browser.waitFor(`document.querySelectorAll('dialog[open] .designer-pin').length > 0`, 'the designer');
    const found = await pins();
    expectTrue(found.length === 16 && distinct(found, 0) === 1 && distinct(found, 1) === 16, `not a column: ${JSON.stringify(found.slice(0, 4))}`);
  });

  await step('the layout field puts the terminals in a row across the width, and back into a column', async () => {
    await setLayout('in a row across the width');
    const row = await pins();
    expectTrue(row.length === 16 && distinct(row, 1) === 1, `not a row: ${JSON.stringify(row.slice(0, 4))}`);
    await setLayout('in a column down the sides');
    const column = await pins();
    expectTrue(column.length === 16 && distinct(column, 0) === 1, `not a column again: ${JSON.stringify(column.slice(0, 4))}`);
  });

  expectTrue(browser.problems.length === 0, `the page raised errors: ${JSON.stringify(browser.problems)}`);
} finally {
  await browser?.close?.();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} step(s) failed`);
  process.exit(1);
}
console.log('\nall steps passed');
process.exit(0);
