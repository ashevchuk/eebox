/**
 * The Place button of the module designer, in a real browser: it is on when the designer opens, a click on the drawing
 * adds a terminal; clicked again it goes off, and then a click on the drawing adds nothing while a click on a terminal
 * still selects it. Run `npm run build:dist-file` first.
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

const pins = () => browser.evaluate(`document.querySelectorAll('.designer-dialog[open] .designer-pin').length`);
const placeIsOn = () => browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] button')].find((b) => b.textContent === 'Place').classList.contains('active')`);
const pressPlace = () => browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] button')].find((b) => b.textContent === 'Place').click()`);
/** A point of the drawn module that is on no terminal: the middle of its face, a little above the centre line. */
const emptySpot = () =>
  browser.evaluate(`(() => { const r = document.querySelector('.designer-dialog[open] .designer-svg').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height * 0.4]; })()`);
const firstPin = () =>
  browser.evaluate(`(() => { const r = document.querySelector('.designer-dialog[open] .designer-pin').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
const click = async ([x, y]) => {
  await browser.mouse('mousePressed', x, y);
  await browser.mouse('mouseReleased', x, y);
  await wait(200);
};

try {
  browser = await launch();
  await browser.goto(page);
  await browser.evaluate(`localStorage.setItem('eebox:tour-done', 'yes')`);
  await browser.goto(page);
  await browser.resize(1516, 784);
  await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the palette');

  await step('a module is dropped on a rail and opened in the designer with Place on', async () => {
    await browser.evaluate(`(() => { const s = document.getElementById('palette-search'); s.value = '3P+N 63'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await browser.waitFor(`document.querySelector('#palette .module')`, 'the module in the palette');
    const from = await browser.evaluate(`(() => { const r = document.querySelector('#palette .module').getBoundingClientRect(); return [r.x + 20, r.y + r.height / 2]; })()`);
    await browser.mouse('mousePressed', from[0], from[1]);
    await browser.mouse('mouseMoved', from[0] + 80, from[1]);
    await browser.mouse('mouseMoved', 700, 411);
    await browser.mouse('mouseMoved', 702, 411);
    await browser.mouse('mouseReleased', 702, 411);
    await wait(500);
    await browser.evaluate(`[...document.querySelectorAll('#inspector button')].find((x) => /Edit module/.test(x.textContent))?.click()`);
    await browser.waitFor(`document.querySelector('.designer-dialog[open] .designer-pin')`, 'the designer');
    expectTrue(await placeIsOn(), 'Place is not on when the designer opens');
  });

  let before;
  await step('with Place on, a click on the drawing adds a terminal', async () => {
    before = await pins();
    await click(await emptySpot());
    expectTrue((await pins()) === before + 1, `terminals went from ${before} to ${await pins()}`);
  });

  await step('a click on Place switches it off, and a click on the drawing adds nothing', async () => {
    await pressPlace();
    expectTrue(!(await placeIsOn()), 'Place stays on after a second click');
    const count = await pins();
    await click(await emptySpot());
    expectTrue((await pins()) === count, `a terminal was added with Place off (${count} to ${await pins()})`);
  });

  await step('with Place off a click on a terminal still selects it', async () => {
    await click(await firstPin());
    expectTrue(/Terminal \d+/.test(await browser.evaluate(`document.querySelector('.designer-dialog[open] .designer-fields').innerText`)), 'no terminal was selected');
  });

  await step('a click on Place switches it on again', async () => {
    await pressPlace();
    expectTrue(await placeIsOn(), 'Place did not come back');
    const count = await pins();
    await click(await emptySpot());
    expectTrue((await pins()) === count + 1, 'a click did not add a terminal');
  });

  expectTrue(browser.problems.length === 0, `the page raised errors: ${JSON.stringify(browser.problems)}`);
} finally {
  await browser?.close();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} step(s) failed`);
  process.exit(1);
}
console.log('\ndesigner select test passed');
