/**
 * Removing a terminal that the logic of a contactor names, in the module designer in a real browser: the designer takes
 * the logic off and says so instead of showing validation errors that leave Save disabled, and its Undo brings the
 * terminal and the logic back. Run `npm run build:dist-file` first.
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

const dialogText = (selector) => browser.evaluate(`document.querySelector('.designer-dialog[open] ${selector}')?.innerText ?? ''`);
const pins = () => browser.evaluate(`document.querySelectorAll('.designer-dialog[open] .designer-pin').length`);
const press = (label) => browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] button')].find((b) => b.textContent === ${JSON.stringify(label)})?.click()`);

try {
  browser = await launch();
  await browser.goto(page);
  await browser.evaluate(`localStorage.setItem('eebox:tour-done', 'yes')`);
  await browser.goto(page);
  await browser.resize(1516, 784);
  await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the palette');

  await step('a contactor is dropped on a rail and opened in the designer', async () => {
    await browser.evaluate(`(() => { const s = document.getElementById('palette-search'); s.value = 'Contactor 3P 20A'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await browser.waitFor(`document.querySelector('#palette .module')`, 'the contactor in the palette');
    const from = await browser.evaluate(`(() => { const r = document.querySelector('#palette .module').getBoundingClientRect(); return [r.x + 20, r.y + r.height / 2]; })()`);
    await browser.mouse('mousePressed', from[0], from[1]);
    await browser.mouse('mouseMoved', from[0] + 80, from[1]);
    await browser.mouse('mouseMoved', 700, 411);
    await browser.mouse('mouseMoved', 702, 411);
    await browser.mouse('mouseReleased', 702, 411);
    await wait(500);
    await browser.evaluate(`[...document.querySelectorAll('#inspector button')].find((x) => /Edit module/.test(x.textContent))?.click()`);
    await browser.waitFor(`document.querySelector('.designer-dialog[open] .designer-pin')`, 'the designer');
    expectTrue((await dialogText('.editor-errors')) === '', 'the contactor starts with errors');
  });

  let before;
  await step('removing a terminal of the coil shows no errors and says the logic was taken off', async () => {
    before = await pins();
    const spot = await browser.evaluate(`(() => { const r = document.querySelector('.designer-dialog[open] .designer-pin').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    await browser.mouse('mousePressed', spot[0], spot[1]);
    await browser.mouse('mouseReleased', spot[0], spot[1]);
    await wait(200);
    await press('Remove terminal');
    await wait(300);
    expectTrue((await pins()) === before - 1, `terminals went from ${before} to ${await pins()}`);
    expectTrue((await dialogText('.editor-errors')) === '', `errors: ${await dialogText('.editor-errors')}`);
    expectTrue(/taken off/.test(await dialogText('.editor-status')), `the status says: ${await dialogText('.editor-status')}`);
  });

  await step('Undo brings the terminal back', async () => {
    await press('Undo');
    await wait(300);
    expectTrue((await pins()) === before, `terminals are ${await pins()}, were ${before}`);
  });

  expectTrue(browser.problems.length === 0, `the page raised errors: ${JSON.stringify(browser.problems)}`);
} finally {
  await browser?.close();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} step(s) failed`);
  process.exit(1);
}
console.log('\ndesigner logic test passed');
