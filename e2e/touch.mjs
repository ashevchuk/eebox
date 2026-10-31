/**
 * The drawing under a finger, in a real browser with a touch screen emulated in a small window: a tap selects, a
 * finger held still opens the context menu and an item of it is chosen by a tap, a finger that moves drags a module
 * along its rail without opening the menu, one finger pans the empty drawing, and a module is dragged from the
 * library drawer onto a rail. The points are those of the bundled house panel after Fit in a 900 by 600 window.
 * Run `npm run build:dist-file` first.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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

const down = (x, y) => browser.touch('touchStart', [{ x, y, id: 1 }]);
const move = (x, y) => browser.touch('touchMove', [{ x, y, id: 1 }]);
const up = () => browser.touch('touchEnd', []);
const tap = async (x, y) => {
  await down(x, y);
  await wait(60);
  await up();
  await wait(250);
};
const saved = () => browser.evaluate(`(async () => { await new Promise((r) => setTimeout(r, 1100)); return JSON.parse(localStorage.getItem('eebox:autosave')).project; })()`);
const menuItems = () => browser.evaluate(`[...document.querySelectorAll('.context-menu .context-item span')].map((x) => x.textContent)`);

try {
  browser = await launch();
  await browser.goto(page);
  await browser.evaluate(`localStorage.setItem('eebox:tour-done', 'yes')`);
  await browser.goto(page);
  await browser.resize(900, 600, true);
  await browser.touchScreen(true);
  await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the palette');
  await browser.evaluate(`(async () => {
    const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(example)}], 'house-panel.json'));
    const input = document.getElementById('open-project'); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click();
  })()`);
  await browser.waitFor(`document.getElementById('status').textContent.includes('loaded')`, 'the project to load');
  await browser.evaluate(`document.getElementById('fit').click()`);
  await wait(600);

  await step('with a touch screen the buttons are made taller for a finger', async () => {
    const height = await browser.evaluate(`Math.round(document.getElementById('mode-panel').getBoundingClientRect().height)`);
    expectTrue(height >= 36, `a button is ${height} px high`);
  });

  await step('a tap selects the module under the finger', async () => {
    await tap(265, 250);
    expectTrue(/Main switch/.test(await browser.evaluate(`document.getElementById('inspector').innerText`)), 'the module was not selected');
  });

  await step('a finger held still opens the context menu, and a tap on an item runs it', async () => {
    await tap(1, 1);
    await down(265, 250);
    await wait(900);
    await up();
    await wait(400);
    expectTrue((await menuItems()).includes('Take off the rail'), `no menu: ${JSON.stringify(await menuItems())}`);
    const at = await browser.evaluate(`(() => { const x = [...document.querySelectorAll('.context-menu .context-item')].find((y) => y.querySelector('span').textContent === 'Take off the rail'); const r = x.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    await tap(...at);
    expectTrue((await menuItems()).length === 0, 'the menu stayed open after the tap');
    const project = await saved();
    expectTrue(project.panel.shelf.length === 1, `the shelf holds ${project.panel.shelf.length}`);
    await browser.evaluate(`document.getElementById('undo').click()`);
    await wait(300);
  });

  await step('a finger that moves drags a module along its rail, and the menu does not open', async () => {
    await tap(1, 1);
    const slotOf = async () => (await saved()).panel.placements.find((p) => p.label === 'Oven').slot;
    const before = await slotOf();
    await down(258, 410);
    await wait(80);
    for (let i = 1; i <= 8; i++) {
      await move(258 + i * 30, 410);
      await wait(120);
    }
    await up();
    await wait(400);
    expectTrue((await menuItems()).length === 0, 'the menu opened during a drag');
    const after = await slotOf();
    expectTrue(after !== before, `the module stayed at ${before}`);
  });

  await step('one finger on empty space pans the drawing', async () => {
    const before = await browser.screenshot();
    await down(100, 520);
    await wait(60);
    for (let i = 1; i <= 6; i++) {
      await move(100 + i * 12, 520 - i * 10);
      await wait(30);
    }
    await up();
    await wait(300);
    expectTrue(Buffer.compare(before, await browser.screenshot()) !== 0, 'the drawing did not move');
  });

  await step('a module is dragged from the library drawer onto a rail with a finger', async () => {
    await tap(640, 25);
    await wait(500);
    await browser.evaluate(`(() => { const s = document.getElementById('palette-search'); s.value = 'MCB 1P'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await wait(500);
    const from = await browser.evaluate(`(() => { const m = [...document.querySelectorAll('#palette .module')].find((x) => x.getBoundingClientRect().height > 0 && x.offsetParent !== null); const r = m.getBoundingClientRect(); return [r.x + 20, r.y + r.height / 2]; })()`);
    const before = (await saved()).panel.placements.length;
    await down(...from);
    await wait(100);
    for (let i = 1; i <= 10; i++) {
      await move(from[0] + i * 38, from[1] - i * 6);
      await wait(40);
    }
    await move(660, 343);
    await wait(80);
    await move(662, 343);
    await wait(80);
    await up();
    await wait(500);
    const after = (await saved()).panel.placements.length;
    expectTrue(after === before + 1, `${before} modules before, ${after} after`);
  });

  expectTrue(browser.problems.length === 0, `the page raised errors: ${JSON.stringify(browser.problems)}`);
} finally {
  await browser?.close();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} step(s) failed`);
  process.exit(1);
}
console.log('\ntouch test passed');
