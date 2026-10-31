/**
 * Delete in the Face editor, in a real browser: it removes the chosen shape of the module that is being designed and
 * nothing else; the module that stands on the rail behind the dialog stays where it is. Run `npm run build:dist-file` first.
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

const placed = () =>
  browser.evaluate(`(async () => { await new Promise((r) => setTimeout(r, 1200)); return JSON.parse(localStorage.getItem('eebox:autosave')).project.panel.placements.length; })()`);
const shapeCount = () =>
  browser.evaluate(`Number(/\\((\\d+)\\)/.exec([...document.querySelectorAll('.designer-dialog[open] h3, .designer-dialog[open] h2, .designer-dialog[open] strong')].map((h) => h.textContent).find((t) => /^Shapes, bottom to top/.test(t)) ?? '')?.[1])`);

try {
  browser = await launch();
  await browser.goto(page);
  await browser.evaluate(`localStorage.setItem('eebox:tour-done', 'yes')`);
  await browser.goto(page);
  await browser.resize(1516, 784);
  await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the palette');

  await step('a module is dropped on a rail and opened in the designer, in the Face mode', async () => {
    await browser.evaluate(`(() => { const s = document.getElementById('palette-search'); s.value = '3P+N 63'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await browser.waitFor(`document.querySelector('#palette .module')`, 'the module in the palette');
    const from = await browser.evaluate(`(() => { const r = document.querySelector('#palette .module').getBoundingClientRect(); return [r.x + 20, r.y + r.height / 2]; })()`);
    await browser.mouse('mousePressed', from[0], from[1]);
    await browser.mouse('mouseMoved', from[0] + 80, from[1]);
    await browser.mouse('mouseMoved', 700, 411);
    await browser.mouse('mouseMoved', 702, 411);
    await browser.mouse('mouseReleased', 702, 411);
    await wait(500);
    expectTrue((await placed()) === 1, 'the module was not placed');
    await browser.evaluate(`[...document.querySelectorAll('#inspector button')].find((x) => /Edit module/.test(x.textContent))?.click()`);
    await browser.waitFor(`document.querySelector('.designer-dialog[open]')`, 'the designer');
    await browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] button')].find((b) => b.textContent === 'Face')?.click()`);
    await browser.waitFor(`/Shapes, bottom to top/.test(document.querySelector('.designer-dialog[open]').innerText)`, 'the list of shapes');
  });

  await step('Delete removes the chosen shape and leaves the module on the rail', async () => {
    const before = await shapeCount();
    expectTrue(before >= 1, `no shapes to delete (${before})`);
    await browser.evaluate(`(() => { const row = [...document.querySelectorAll('.designer-dialog[open] button')].find((b) => /^1\\. /.test(b.textContent)); row.click(); })()`);
    await browser.key('Delete', 'Delete', 46);
    await wait(300);
    expectTrue((await shapeCount()) === before - 1, `the shape count went from ${before} to ${await shapeCount()}`);
    expectTrue((await placed()) === 1, 'the module on the rail was deleted');
  });

  expectTrue(browser.problems.length === 0, `the page raised errors: ${JSON.stringify(browser.problems)}`);
} finally {
  await browser?.close();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} step(s) failed`);
  process.exit(1);
}
console.log('\nface delete test passed');
