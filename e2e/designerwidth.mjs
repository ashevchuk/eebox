/**
 * The width slider of the module designer, in a real browser: it moves by a quarter of a unit, shows at most
 * two decimals, and while it is dragged the stage and the rail preview below it keep their size and place.
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
const measure = () =>
  browser.evaluate(`(() => {
    const d = document.querySelector('.designer-dialog[open]');
    const svg = d.querySelector('.designer-svg'); const rail = d.querySelector('canvas'); const slider = d.querySelector('.designer-width input');
    return { label: d.querySelector('.designer-width span').textContent, step: slider.step, svgHeight: Math.round(svg.getBoundingClientRect().height), railTop: Math.round(rail.getBoundingClientRect().top), railHeight: Math.round(rail.getBoundingClientRect().height), caption: [...svg.querySelectorAll('text')].map((t) => t.textContent).filter((t) => /unit/.test(t)).join('|') };
  })()`);

try {
  browser = await launch();
  await browser.goto(page);
  await browser.evaluate(`localStorage.setItem('eebox:tour-done', 'yes')`);
  await browser.goto(page);
  await browser.resize(1516, 784);
  await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the palette');

  await step('a resizable meter is dropped on a rail and opened in the designer', async () => {
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
    await browser.waitFor(`document.querySelector('.designer-dialog[open] .designer-width input')`, 'the designer');
    expectTrue((await measure()).step === '0.25', 'the slider does not move by a quarter unit');
  });

  await step('dragging the slider shows at most two decimals and keeps the stage and the rail preview where they are', async () => {
    const box = await browser.evaluate(`(() => { const r = document.querySelector('.designer-dialog[open] .designer-width input').getBoundingClientRect(); return [r.left, r.top + r.height / 2, r.width]; })()`);
    const seen = [];
    await browser.mouse('mousePressed', box[0] + 3, box[1]);
    for (let i = 1; i <= 24; i++) {
      await browser.mouse('mouseMoved', box[0] + 3 + ((box[2] - 6) * i) / 24, box[1]);
      seen.push(await measure());
    }
    await browser.mouse('mouseReleased', box[0] + box[2] - 3, box[1]);
    const labels = [...new Set(seen.map((m) => m.label))];
    expectTrue(labels.length > 3, `the slider did not move: ${labels.join(' | ')}`);
    expectTrue(seen.every((m) => !/\d\.\d{3,}/.test(m.label + m.caption)), `long decimals: ${labels.join(' | ')}`);
    expectTrue(new Set(seen.map((m) => m.svgHeight)).size === 1, `the stage changed its height: ${[...new Set(seen.map((m) => m.svgHeight))]}`);
    expectTrue(new Set(seen.map((m) => m.railTop)).size === 1 && new Set(seen.map((m) => m.railHeight)).size === 1, 'the rail preview moved or changed its height');
  });

  expectTrue(browser.problems.length === 0, `the page raised errors: ${JSON.stringify(browser.problems)}`);
} finally {
  await browser?.close();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} step(s) failed`);
  process.exit(1);
}
console.log('\ndesigner width test passed');
