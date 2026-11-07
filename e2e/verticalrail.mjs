/**
 * A vertical rail in a real browser: a row of a project is chosen on the panel, turned to vertical in the inspector,
 * moved with the fields of a vertical rail, and the autosave keeps it; then it is turned back. Run `npm run build:dist-file` first.
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
const rails = () =>
  browser.evaluate(`(async () => { await new Promise((r) => setTimeout(r, 900)); return JSON.parse(localStorage.getItem('eebox:autosave')).project.panel.rails; })()`);
const labels = () => browser.evaluate(`[...document.querySelectorAll('#inspector .inspector-field label')].map((l) => l.textContent)`);
const setField = (label, value) =>
  browser.evaluate(`(() => { const i = [...document.querySelectorAll('#inspector .inspector-field')].find((r) => r.querySelector('label')?.textContent === ${JSON.stringify(label)}).querySelector('input,select'); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);

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

  await step('a row is chosen with a click on its rail and offers its orientation', async () => {
    await browser.mouse('mousePressed', 1015, 300);
    await browser.mouse('mouseReleased', 1015, 300);
    await wait(300);
    const shown = await labels();
    expectTrue(shown.includes('Orientation') && shown.includes('Left end'), `the fields of a horizontal row were not shown: ${shown}`);
  });

  await step('turning it makes it vertical, names its position by the centre line and the top end, and the autosave keeps it', async () => {
    await setField('Orientation', 'vertical');
    await wait(300);
    const shown = await labels();
    expectTrue(shown.includes('Centre line') && shown.includes('Top end') && !shown.includes('Left end'), `the fields of a vertical row were not shown: ${shown}`);
    expectTrue((await rails())[0].orientation === 'vertical', 'the autosave does not hold the vertical row');
  });

  await step('the centre line is moved with its field', async () => {
    await setField('Centre line', '300');
    await wait(300);
    expectTrue((await rails())[0].x === 300, 'the x of the rail did not change');
  });

  await step('turning it back makes it horizontal again', async () => {
    await setField('Orientation', 'horizontal');
    await wait(300);
    expectTrue((await rails())[0].orientation === 'horizontal', 'the rail is still vertical');
    expectTrue((await labels()).includes('Left end'), 'the fields of a horizontal row did not come back');
  });
} finally {
  await browser?.close?.();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} step(s) failed`);
  process.exit(1);
}
console.log('\nall steps passed');
process.exit(0);
