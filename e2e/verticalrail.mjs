/**
 * A vertical rail in a real browser: a row of a project is chosen on the panel, turned to vertical in the inspector,
 * moved with the fields of a vertical rail, and the autosave keeps it; then it is turned back. Then two bars stand on a
 * vertical rail of a wider plate, and the arrow keys, copy and paste work along it; a row is added with the button, a bar of one row
 * is dragged onto it and a breaker is not. Run `npm run build:dist-file` first.
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

  const upright = JSON.parse(example);
  const { panel } = upright.project;
  panel.plates[0].widthMm = 600;
  panel.rails.push({ plate: panel.rails[0].plate, orientation: 'vertical', x: 520, y: 60, lengthUnits: 20 });
  for (const placement of panel.placements) {
    if (placement.id === 'p3') Object.assign(placement, { rail: 2, slot: 0 });
    if (placement.id === 'p4') Object.assign(placement, { rail: 2, slot: 7 });
  }
  const placements = async () => (await saved()).placements.filter((p) => p.rail === 2).map((p) => [p.id, p.slot]).sort((a, b) => a[0].localeCompare(b[0]));
  const saved = () =>
    browser.evaluate(`(async () => { await new Promise((r) => setTimeout(r, 900)); return JSON.parse(localStorage.getItem('eebox:autosave')).project.panel; })()`);
  const press = (code, modifiers = 0) => browser.key(code, code, 0, '', modifiers);

  await step('two bars stand on a vertical rail, and a click selects one of them', async () => {
    await browser.evaluate(`(async () => {
      const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(JSON.stringify(upright))}], 'upright.json'));
      const input = document.getElementById('open-project'); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 600));
      [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click();
    })()`);
    await browser.waitFor(`document.getElementById('status').textContent.includes('loaded')`, 'the project to load');
    await browser.evaluate(`document.getElementById('fit').click()`);
    await wait(500);
    await browser.mouse('mousePressed', 1040, 312);
    await browser.mouse('mouseReleased', 1040, 312);
    await wait(300);
    expectTrue(/Module/.test(await browser.evaluate(`document.getElementById('inspector').innerText`)), 'no module was chosen');
  });

  await step('the down arrow moves the bar a unit down the rail and the up arrow back', async () => {
    await press('ArrowDown');
    await wait(200);
    expectTrue(JSON.stringify(await placements()) === JSON.stringify([['p3', 1], ['p4', 7]]), `the bar did not move down the rail: ${JSON.stringify(await placements())}`);
    await press('ArrowUp');
    await wait(200);
    expectTrue(JSON.stringify(await placements()) === JSON.stringify([['p3', 0], ['p4', 7]]), `the bar did not come back: ${JSON.stringify(await placements())}`);
  });

  await step('a copy of the bar is pasted on the same vertical rail, in a free place', async () => {
    await press('KeyC', 2);
    await press('KeyV', 2);
    await wait(300);
    const found = await placements();
    expectTrue(found.length === 3, `the copy is not on the rail: ${JSON.stringify(found)}`);
    const slots = found.map(([, slot]) => slot).sort((a, b) => a - b);
    expectTrue(slots.every((slot, i) => i === 0 || slot >= slots[i - 1] + 6), `the copy overlaps a bar: ${slots}`);
  });

  const search = async (query) => {
    await browser.evaluate(`(() => { const s = document.getElementById('palette-search'); s.value = ${JSON.stringify(query)}; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await wait(400);
  };
  const dragFromPalette = async (to) => {
    const from = await browser.evaluate(`(() => { const r = document.querySelector('#palette .module').getBoundingClientRect(); return [r.x + 20, r.y + r.height / 2]; })()`);
    await browser.mouse('mousePressed', from[0], from[1]);
    await browser.mouse('mouseMoved', from[0] + 60, from[1] + 10);
    await browser.mouse('mouseMoved', to[0] - 4, to[1] - 4);
    await browser.mouse('mouseMoved', to[0], to[1]);
    await wait(150);
    await browser.mouse('mouseReleased', to[0], to[1]);
    await wait(300);
  };
  /** The vertical rail on the canvas: the tallest run of the colour of a rail, found by looking at the pixels. */
  const verticalRailOnCanvas = () =>
    browser.evaluate(`(() => {
      const c = document.getElementById('stage'); const box = c.getBoundingClientRect(); const g = c.getContext('2d');
      const k = c.width / box.width; const d = g.getImageData(0, 0, c.width, c.height).data;
      let best = null;
      for (let x = 0; x < c.width; x += 2) {
        let run = 0, start = 0, top = 0, len = 0;
        for (let y = 0; y < c.height; y++) {
          const i = (y * c.width + x) * 4;
          const hit = Math.abs(d[i] - 0x9a) < 6 && Math.abs(d[i + 1] - 0xa1) < 6 && Math.abs(d[i + 2] - 0xb3) < 6;
          if (hit) { if (run === 0) start = y; run++; if (run > len) { len = run; top = start; } } else run = 0;
        }
        if (!best || len > best.len) best = { x, top, len };
      }
      return { x: box.left + best.x / k, top: box.top + best.top / k, len: best.len / k };
    })()`);
  const checkCount = () => browser.evaluate(`document.getElementById('check').dataset.count ?? ''`);
  let rail;
  const wide = JSON.parse(example);
  wide.project.panel.plates[0].widthMm = 700;

  await step('Add vertical row puts a vertical row to the right of the rows and selects it', async () => {
    await browser.evaluate(`(async () => {
      const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(JSON.stringify(wide))}], 'house.json'));
      const input = document.getElementById('open-project'); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 600));
      [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click();
    })()`);
    await browser.waitFor(`document.getElementById('status').textContent.includes('loaded')`, 'the project to load');
    await browser.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Add vertical row').click()`);
    await wait(400);
    const rails = await saved().then((p) => p.rails);
    const added = rails.at(-1);
    expectTrue(rails.length === 3 && added.orientation === 'vertical', `no vertical row was added: ${JSON.stringify(rails)}`);
    expectTrue(added.x === 24 * 17.5 + 60 && added.y === 40, `the row is not to the right of the rows: ${JSON.stringify(added)}`);
    expectTrue((await labels()).includes('Centre line'), 'the new row is not the one selected');
    const names = await browser.evaluate(`[...document.querySelectorAll('#panel-editor span, #panel-editor-host span, #sidebar span')].map((e) => e.textContent.trim())`);
    expectTrue(names.includes('centre') && names.includes('top'), `the position fields are not named for a vertical row: ${names.slice(0, 12)}`);
  });

  await step('a bar of one row dragged from the palette stands on the new vertical row and Check stays quiet', async () => {
    await browser.evaluate(`document.getElementById('fit').click()`);
    await wait(500);
    rail = await verticalRailOnCanvas();
    await search('phase l1 bar 16 terminals, one row');
    await dragFromPalette([Math.round(rail.x), Math.round(rail.top + rail.len * 0.3)]);
    const found = (await saved()).placements.filter((p) => p.rail === 2);
    expectTrue(found.length === 1 && found[0].module.moduleId === 'l1-row-16', `the bar is not on the vertical row: ${JSON.stringify(found)}`);
    expectTrue((await checkCount()) === '', `Check found something: ${await checkCount()}`);
  });

  await step('a protective device is not put on the vertical row', async () => {
    await search('mcb 1p c16');
    await dragFromPalette([Math.round(rail.x), Math.round(rail.top + rail.len * 0.8)]);
    const onRail = (await saved()).placements.filter((p) => p.rail === 2);
    expectTrue(onRail.length === 1, `a breaker stands on the vertical row: ${JSON.stringify(onRail)}`);
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
