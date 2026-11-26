/**
 * Icons on the marking strips, in a real browser: the picker opens from the inspector, finds an icon,
 * imports an SVG into the person's own icons and keeps it after a reload, and the printed strip draws
 * the icon inside its cell. The point of the oven breaker is that of the house example after Fit in a
 * 1516 by 784 window. Run `npm run build:dist-file` first.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from './browser.mjs';

const page = pathToFileURL(resolve('dist-file/index.html')).href;
const example = readFileSync(resolve('examples/house-panel.json'), 'utf8');
const OVEN_BREAKER = [472, 530];
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
const click = async (x, y) => {
  await browser.mouse('mouseMoved', x, y);
  await browser.mouse('mousePressed', x, y);
  await browser.mouse('mouseReleased', x, y);
  await wait(300);
};
const openExample = async () => {
  await browser.evaluate(`(async () => {
    const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(example)}], 'house-panel.json'));
    const input = document.getElementById('open-project'); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    [...document.querySelectorAll('dialog[open] button')].find((b) => b.classList.contains('primary'))?.click();
  })()`);
  await browser.waitFor(`document.getElementById('status').textContent.includes('loaded')`, 'the project to load');
  await browser.evaluate(`document.getElementById('fit').click()`);
  await wait(400);
};
const openPicker = async () => {
  await click(...OVEN_BREAKER);
  await browser.evaluate(`[...document.querySelectorAll('#inspector button')].find((b) => b.textContent === 'Choose icon…').click()`);
  await browser.waitFor(`document.querySelector('dialog.icon-picker')`, 'the icon picker');
};
const search = (text) => browser.evaluate(`(() => { const s = document.querySelector('.icon-picker input[type=search]'); s.value = ${JSON.stringify(text)}; s.dispatchEvent(new Event('input')); })()`);
const shownNames = () => browser.evaluate(`[...document.querySelectorAll('.icon-cell .icon-name')].map((n) => n.textContent)`);
const inspectorLine = (label) => browser.evaluate(`(() => { const lines = document.getElementById('inspector').innerText.split('\\n'); return lines[lines.indexOf(${JSON.stringify(label)}) + 1]; })()`);

try {
  browser = await launch();
  await browser.goto(page);
  await browser.evaluate(`localStorage.setItem('eebox:tour-done', 'yes')`);
  await browser.goto(page);
  await browser.resize(1516, 784);
  await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the palette');
  await openExample();

  await step('the inspector of a breaker opens the picker with every bundled icon, and a search narrows it', async () => {
    await openPicker();
    expectTrue((await browser.evaluate(`document.querySelectorAll('.icon-cell').length`)) === 212, 'not all 212 bundled icons are listed');
    await search('oven');
    const names = await shownNames();
    expectTrue(names.includes('Oven') && names.every((n) => /oven/i.test(n)), `search for oven shows ${names.join(', ')}`);
  });

  await step('an SVG is imported into My icons and can be found', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 18"><path d="M2 14 L12 2 L22 14 Z"/></svg>';
    await browser.evaluate(`(async () => {
      const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(svg)}], 'Sail_boat.svg', { type: 'image/svg+xml' }));
      const input = document.querySelector('.icon-picker input[type=file]'); input.files = data.files; input.dispatchEvent(new Event('change'));
    })()`);
    await browser.waitFor(`[...document.querySelectorAll('.icon-status')].some((s) => s.textContent === '1 icon imported.')`, 'the import to be reported');
    await search('sail');
    expectTrue((await shownNames()).join() === 'Sail boat', 'the imported icon is not listed');
  });

  await step('picking an icon puts it on the breaker and the inspector names it', async () => {
    await search('oven');
    await browser.evaluate(`[...document.querySelectorAll('.icon-cell')].find((c) => c.title === 'Oven').click()`);
    await wait(300);
    expectTrue(!(await browser.evaluate(`document.querySelector('dialog.icon-picker')`)), 'the picker stayed open');
    const shown = await inspectorLine('Strip icon');
    expectTrue(shown === 'Oven', `the inspector says "${shown}"`);
  });

  await step('the printed strip draws the icon inside its cell, above the text', async () => {
    await browser.evaluate(`window.print = () => {}; document.getElementById('print-labels').click()`);
    await browser.waitFor(`document.querySelectorAll('#print-sheet .mark-icon svg').length === 1`, 'one icon on the strips');
    await browser.media('print');
    await wait(200);
    const fits = await browser.evaluate(`(() => {
      const icon = document.querySelector('#print-sheet .mark-icon');
      const svg = icon.querySelector('svg').getBoundingClientRect(), box = icon.getBoundingClientRect(), cell = icon.parentElement.getBoundingClientRect();
      const text = icon.parentElement.querySelector('.mark-text-line').getBoundingClientRect();
      return Math.abs(svg.height - box.height) < 1 && svg.bottom <= cell.bottom + 0.5 && svg.top >= cell.top - 0.5 && svg.bottom <= text.top + 0.5;
    })()`);
    await browser.media('screen');
    expectTrue(fits, 'the icon is not drawn within its box above the text');
  });

  await step('the imported icon is still there after a reload', async () => {
    await browser.goto(page);
    await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the palette');
    await openExample();
    await openPicker();
    await search('sail');
    expectTrue((await shownNames()).join() === 'Sail boat', 'the imported icon is gone after a reload');
    await browser.evaluate(`[...document.querySelectorAll('.icon-picker button')].find((b) => b.textContent === 'Cancel').click()`);
  });

  await step('the page raised no errors', async () => {
    const problems = browser.problems;
    expectTrue(problems.length === 0, problems.join('; '));
  });
} finally {
  await browser?.close();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} step(s) failed`);
  process.exit(1);
}
console.log('all steps passed');
