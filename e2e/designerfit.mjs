/**
 * Making a module of a fixed width narrower in the module designer, in a real browser: the terminals are scaled to the
 * new width instead of staying where they no longer fit, so there is no list of errors that blocks Save.
 * Run `npm run build:dist-file` first.
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

const errors = () => browser.evaluate(`document.querySelector('.designer-dialog[open] .editor-errors')?.innerText ?? ''`);
const pins = () => browser.evaluate(`document.querySelectorAll('.designer-dialog[open] .designer-pin').length`);
const setWidth = (value) =>
  browser.evaluate(`(() => {
    const row = [...document.querySelectorAll('.designer-dialog[open] .inspector-field')].find((r) => r.firstElementChild?.textContent === 'Width');
    const input = row.querySelector('input');
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);

try {
  browser = await launch();
  await browser.goto(page);
  await browser.evaluate(`localStorage.setItem('eebox:tour-done', 'yes')`);
  await browser.goto(page);
  await browser.resize(1516, 784);
  await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the palette');

  await step('a surge protector 8 units wide is dropped and opened in the designer without errors', async () => {
    await browser.evaluate(`(() => { const s = document.getElementById('palette-search'); s.value = 'SPD type 1 (spark gap) 3P+N'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await browser.waitFor(`document.querySelector('#palette .module')`, 'the module in the palette');
    const from = await browser.evaluate(`(() => { const r = document.querySelector('#palette .module').getBoundingClientRect(); return [r.x + 20, r.y + r.height / 2]; })()`);
    await browser.mouse('mousePressed', from[0], from[1]);
    await browser.mouse('mouseMoved', from[0] + 80, from[1]);
    await browser.mouse('mouseMoved', 600, 411);
    await browser.mouse('mouseMoved', 602, 411);
    await browser.mouse('mouseReleased', 602, 411);
    await wait(500);
    await browser.evaluate(`[...document.querySelectorAll('#inspector button')].find((x) => /Edit module/.test(x.textContent))?.click()`);
    await browser.waitFor(`document.querySelector('.designer-dialog[open] .designer-pin')`, 'the designer');
    expectTrue((await errors()) === '', `errors at the start: ${await errors()}`);
  });

  await step('making it 4 units wide keeps every terminal and leaves no errors', async () => {
    const before = await pins();
    await setWidth('4');
    await wait(400);
    expectTrue((await errors()) === '', `errors: ${await errors()}`);
    expectTrue((await pins()) === before, `terminals went from ${before} to ${await pins()}`);
  });

  expectTrue(browser.problems.length === 0, `the page raised errors: ${JSON.stringify(browser.problems)}`);
} finally {
  await browser?.close();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} step(s) failed`);
  process.exit(1);
}
console.log('\ndesigner fit test passed');
