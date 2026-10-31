/**
 * The list that Check opens, in a real browser: its Close button works on the panel and on the schematic, where the
 * pointer moving over the drawing changes the state all the time, and the list is not made again while its content
 * is the same (a button replaced between the press and the release gets no click). Run `npm run build:dist-file` first.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from './browser.mjs';

const page = pathToFileURL(resolve('dist-file/index.html')).href;
const example = readFileSync(resolve('examples/automation-panel.json'), 'utf8');
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
const hidden = () => browser.evaluate(`document.getElementById('problems').hidden`);
const closeAt = () => browser.evaluate(`(() => { const x = [...document.querySelectorAll('#problems .problems-header button')].find((y) => y.textContent === 'Close'); const r = x.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);

try {
  browser = await launch();
  await browser.goto(page);
  await browser.evaluate(`localStorage.setItem('eebox:tour-done', 'yes')`);
  await browser.goto(page);
  await browser.resize(1516, 784);
  await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the palette');
  await browser.evaluate(`(async () => {
    const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(example)}], 'automation-panel.json'));
    const input = document.getElementById('open-project'); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click();
  })()`);
  await browser.waitFor(`document.getElementById('status').textContent.includes('loaded')`, 'the project to load');

  for (const mode of ['panel', 'schematic']) {
    await step(`on the ${mode} a real click on Close hides the list`, async () => {
      await browser.evaluate(`document.getElementById('mode-${mode}').click()`);
      await wait(500);
      await browser.evaluate(`document.getElementById('check').click()`);
      await browser.waitFor(`!document.getElementById('problems').hidden`, 'the list');
      const [x, y] = await closeAt();
      await browser.mouse('mousePressed', x, y);
      await browser.mouse('mouseReleased', x, y);
      await wait(300);
      expectTrue(await hidden(), 'the list is still shown after Close');
    });
  }

  await step('the list is not made again by the pointer moving over the drawing', async () => {
    await browser.evaluate(`document.getElementById('check').click()`);
    await browser.waitFor(`!document.getElementById('problems').hidden`, 'the list');
    await browser.evaluate(`document.querySelector('#problems .problems-header button').dataset.same = 'yes'`);
    for (let i = 0; i < 12; i++) {
      await browser.mouse('mouseMoved', 400 + i * 40, 300 + i * 10);
      await wait(30);
    }
    expectTrue(await browser.evaluate(`document.querySelector('#problems .problems-header button').dataset.same === 'yes'`), 'the Close button was replaced');
  });

  expectTrue(browser.problems.length === 0, `the page raised errors: ${JSON.stringify(browser.problems)}`);
} finally {
  await browser?.close();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} step(s) failed`);
  process.exit(1);
}
console.log('\nproblems list test passed');
