/**
 * What the later versions added to laying out a plate and to the lists, in a real browser, on the bundled
 * automation example after Fit in a 1516 by 784 window: aligning devices, the grid and Alt, the distance lines and their
 * switch, wire numbers, the wire runs, the cut list, the inputs and outputs and the reading back of terminal labels,
 * and the fill of a duct. Run `npm run build:dist-file` first.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from './browser.mjs';

const page = pathToFileURL(resolve('dist-file/index.html')).href;
const example = JSON.parse(readFileSync(resolve('examples/automation-panel.json'), 'utf8'));
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
const expectEqual = (actual, wanted, what) => expectTrue(JSON.stringify(actual) === JSON.stringify(wanted), `${what}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const saved = () => browser.evaluate(`(async () => { await new Promise((r) => setTimeout(r, 1100)); return JSON.parse(localStorage.getItem('eebox:autosave')).project; })()`);
const open = (content, name, inputId = 'open-project') =>
  browser.evaluate(`(async () => {
    const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(content)}], ${JSON.stringify(name)}));
    const input = document.getElementById(${JSON.stringify(inputId)}); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click();
    await new Promise((r) => setTimeout(r, 400));
  })()`);
const download = (id) =>
  browser.evaluate(`(async () => {
    let blob = null; const create = URL.createObjectURL; URL.createObjectURL = (b) => { blob = b; return create(b); };
    const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {};
    document.getElementById(${JSON.stringify(id)}).click(); await new Promise((r) => setTimeout(r, 700));
    HTMLAnchorElement.prototype.click = click; URL.createObjectURL = create;
    return blob ? await blob.text() : null;
  })()`);
const rubberBand = async (from, to) => {
  await browser.mouse('mousePressed', from[0], from[1], 8);
  await browser.mouse('mouseMoved', (from[0] + to[0]) / 2, (from[1] + to[1]) / 2, 8);
  await browser.mouse('mouseMoved', to[0], to[1], 8);
  await browser.mouse('mouseReleased', to[0], to[1], 8);
  await wait(300);
};
const click = (x, y) => browser.mouse('mousePressed', x, y).then(() => browser.mouse('mouseReleased', x, y));
const inspector = () => browser.evaluate(`document.getElementById('inspector').innerText`);
const free = (project, label) => project.panel.placements.find((p) => p.label === label);
const dimensionPixels = () =>
  browser.evaluate(`(() => { const c = document.getElementById('stage'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 56) < 40 && Math.abs(d[i + 1] - 189) < 40 && Math.abs(d[i + 2] - 248) < 40) n++; return n; })()`);

try {
  browser = await launch();
  await browser.goto(page);
  await browser.evaluate(`localStorage.setItem('eebox:tour-done', 'yes')`);
  await browser.goto(page);
  await browser.resize(1516, 784);
  await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the palette');
  await open(JSON.stringify(example), 'automation-panel.json');
  await browser.waitFor(`document.getElementById('status').textContent.includes('loaded')`, 'the project to load');
  await browser.evaluate(`document.getElementById('fit').click()`);
  await wait(500);

  await step('devices chosen with a rectangle are aligned by their bottoms, and Undo puts them back', async () => {
    const before = await saved();
    await rubberBand([495, 306], [950, 525]);
    expectTrue(/items selected/.test(await inspector()), 'the devices were not chosen together');
    await browser.evaluate(`[...document.querySelectorAll('#inspector button')].find((b) => b.textContent === 'Align bottom edges').click()`);
    const after = await saved();
    expectTrue(JSON.stringify(after.panel.placements) !== JSON.stringify(before.panel.placements), 'nothing moved');
    await browser.evaluate(`document.getElementById('undo').click()`);
    expectEqual((await saved()).panel.placements, before.panel.placements, 'after Undo');
  });

  await step('the distance lines of the selected device can be switched off and on again, and the choice is kept', async () => {
    await browser.evaluate(`document.getElementById('fit').click()`);
    await wait(300);
    await browser.key('Escape', 'Escape', 27);
    await click(798, 400);
    await wait(300);
    const withLines = await dimensionPixels();
    await browser.evaluate(`(() => { const c = document.getElementById('view-dimensions'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await wait(300);
    const without = await dimensionPixels();
    expectTrue(withLines - without > 30, `the lines add only ${withLines - without} pixels of their colour (${withLines} with, ${without} without)`);
    expectEqual(await browser.evaluate(`localStorage.getItem('eebox:dimensions')`), 'no', 'the stored choice');
    await browser.evaluate(`(() => { const c = document.getElementById('view-dimensions'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await wait(300);
    expectTrue((await dimensionPixels()) - without > 30, 'the lines did not come back');
  });

  await step('a device dragged with a grid of 10 lands on it, and with Alt held it does not', async () => {
    await browser.evaluate(`(() => { const s = document.getElementById('view-grid'); s.value = '10'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await browser.mouse('mousePressed', 798, 400);
    await browser.mouse('mouseMoved', 850, 480);
    await browser.mouse('mouseMoved', 971, 593);
    await browser.mouse('mouseReleased', 971, 593);
    const meter = free(await saved(), 'Meter');
    expectTrue(meter.x % 10 === 0 && meter.y % 10 === 0, `the meter is at ${meter.x}, ${meter.y}, not on the grid`);
    await browser.mouse('mousePressed', 971, 593, 1);
    await browser.mouse('mouseMoved', 974, 596, 1);
    await browser.mouse('mouseMoved', 977, 599, 1);
    await browser.mouse('mouseReleased', 977, 599, 1);
    const freed = free(await saved(), 'Meter');
    expectTrue(!(freed.x % 10 === 0 && freed.y % 10 === 0), `with Alt the meter is still on the grid at ${freed.x}, ${freed.y}`);
    await browser.evaluate(`(() => { const s = document.getElementById('view-grid'); s.value = '0'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  });

  await step('the wires are numbered from a pattern with Enter, only those without a label, and Undo takes it back', async () => {
    await browser.evaluate(`document.getElementById('mode-schematic').click()`);
    await wait(400);
    const before = (await saved()).schematic.wires.map((w) => w.label);
    expectTrue(before.some((l) => l === undefined), 'the example has no wire without a label');
    await browser.evaluate(`[...document.querySelectorAll('.menu-button')].find((x) => x.textContent.trim().startsWith('Nodes')).click(); document.getElementById('number-wires').focus(); document.getElementById('number-wires').click()`);
    await browser.waitFor(`document.querySelector('dialog[open] input')`, 'the dialog');
    expectEqual(await browser.evaluate(`document.querySelector('dialog[open] input').value`), 'W{n}', 'the default pattern');
    await browser.key('Enter', 'Enter', 13, '\r');
    const after = (await saved()).schematic.wires.map((w) => w.label);
    expectTrue(after.every((l) => l !== undefined), 'a wire still has no label');
    expectTrue(before.every((l, i) => l === undefined || after[i] === l), 'a label that was there was replaced');
    await browser.evaluate(`document.getElementById('undo').click()`);
    expectEqual((await saved()).schematic.wires.map((w) => w.label), before, 'after Undo');
    await browser.evaluate(`document.getElementById('mode-panel').click()`);
    await wait(300);
  });

  await step('the wire list has the estimated runs, and the cut list adds them up with the rails and the ducts', async () => {
    const wires = (await download('export-wires')).trim().split('\r\n');
    const at = wires[0].split(',').indexOf('Run (mm)');
    expectTrue(at > 0, `no Run (mm) column: ${wires[0]}`);
    const runs = wires.slice(1).map((l) => l.split(',')[at]);
    expectTrue(runs.some((r) => /^\d+$/.test(r)) && runs.some((r) => r === ''), 'the runs are not a mix of numbers and blanks');
    const cuts = (await download('export-cuts')).trim().split('\r\n');
    expectEqual(cuts[0], 'Item,Size,Count,Length (mm),With reserve (mm)', 'the cut list header');
    expectTrue(cuts.some((l) => l.startsWith('DIN rail,35 mm,3,')) && cuts.some((l) => l.startsWith('Cable duct,')) && cuts.some((l) => l.startsWith('Wire,')), cuts.join(' | '));
  });

  await step('the inputs and outputs are exported with Terminal and Label columns, and the file comes back with its labels filled in', async () => {
    const io = (await download('export-io')).trim().split('\r\n');
    expectEqual(io[0], 'Device,Terminal,Label,Side,Conductor,Connected to,Wire', 'the I/O header');
    const first = io.find((l) => l.startsWith('PLC,DI1,'));
    expectTrue(first !== undefined, 'no row for DI1 of the controller');
    const filled = io.map((l, i) => (i > 0 && l.startsWith('PLC,DI1,,') ? l.replace('PLC,DI1,,', 'PLC,DI1,Start button,') : l)).join('\r\n');
    await open(filled, 'io.csv', 'import-terminal-labels');
    expectTrue(/Terminal labels: 1 set, 0 cleared/.test(await browser.evaluate(`document.getElementById('status').textContent`)), await browser.evaluate(`document.getElementById('status').textContent`));
    const plc = (await saved()).panel.placements.find((p) => (p.label ?? '') === 'PLC' || p.terminalLabels?.['top:DI1'] === 'Start button');
    expectEqual(plc.terminalLabels['top:DI1'], 'Start button', 'the label on the controller');
    await open('Name,Value\nx,y\n', 'wrong.csv', 'import-terminal-labels');
    expectTrue(/must name the columns/.test(await browser.evaluate(`document.getElementById('status').textContent`)), 'a file without the columns was not refused');
    await browser.evaluate(`document.getElementById('undo').click()`);
  });

  await step('a duct with a depth shows how full it is, and Check advises when it is over the limit', async () => {
    const project = JSON.parse(JSON.stringify(example));
    const duct = project.project.panel.ducts.find((d) => /Power/.test(d.label ?? ''));
    duct.depthMm = 12;
    project.project.schematic.wires.slice(4, 16).forEach((w) => {
      w.duct = duct.id;
      w.crossSectionMm2 = 10;
    });
    await open(JSON.stringify(project), 'fill.json');
    await browser.evaluate(`document.getElementById('fit').click()`);
    await wait(400);
    await click(720, 289);
    await wait(300);
    const text = await inspector();
    expectTrue(/Fill/.test(text) && /% of the 50 % allowed/.test(text) && /12 wires/.test(text), text.slice(0, 400));
    await browser.evaluate(`document.getElementById('check').click()`);
    await wait(500);
    expectTrue(/full of wires/.test(await browser.evaluate(`document.getElementById('problems').innerText`)), 'Check has no advice about the duct');
  });

  expectTrue(browser.problems.length === 0, `the page raised errors: ${JSON.stringify(browser.problems)}`);
} finally {
  await browser?.close();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} step(s) failed`);
  process.exit(1);
}
console.log('\nfeatures test passed');
