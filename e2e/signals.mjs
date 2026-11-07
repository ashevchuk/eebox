/**
 * The connection diagram of an automation panel, in a real browser: a controller wired through a terminal
 * strip to a field device with a signal pair, the terminal schedule on the screen and as a CSV, and no
 * problem reported. Run `npm run build:dist-file` first.
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

const module = (id, kind, name, widthUnits, terminals) => ({ id, kind, name, widthUnits, heightMm: 90, mounting: 'rail', poles: 1, terminals });
const controller = module('plc-ai', 'plc', 'Controller', 4, [
  { name: 'AI1', conductor: 'SP', side: 'top', unit: 0 },
  { name: 'AI1N', conductor: 'SN', side: 'top', unit: 1 },
]);
const strip = module('strip', 'terminal', 'Terminal strip', 3, [
  { name: '1', conductor: 'SP', side: 'top', unit: 0, net: 'w1' },
  { name: '1b', conductor: 'SP', side: 'bottom', unit: 0, net: 'w1' },
  { name: '2', conductor: 'SN', side: 'top', unit: 1, net: 'w2' },
  { name: '2b', conductor: 'SN', side: 'bottom', unit: 1, net: 'w2' },
]);
const project = {
  format: 'eebox-project',
  version: 1,
  modules: { 'lib/plc-ai': controller, 'lib/strip': strip },
  project: {
    panel: {
      title: 'Signals',
      plates: [{ id: 'plate1', name: 'Back plate', widthMm: 300, heightMm: 300 }],
      rails: [{ plate: 'plate1', orientation: 'horizontal', x: 0, y: 110, lengthUnits: 12 }],
      placements: [
        { id: 'p1', module: { libraryId: 'lib', moduleId: 'plc-ai' }, rail: 0, slot: 0 },
        { id: 'p2', module: { libraryId: 'lib', moduleId: 'strip' }, rail: 0, slot: 5, label: 'X1', terminalLabels: { 'top:1': 'X1:1', 'top:2': 'X1:2' } },
      ],
      combs: [],
      shelf: [],
    },
    schematic: {
      nodes: [
        { id: 'n1', kind: 'module', label: 'Controller', x: 0, y: 0, placementId: 'p1' },
        { id: 'n2', kind: 'module', label: 'Terminal strip', x: 300, y: 0, placementId: 'p2' },
        { id: 'n3', kind: 'load', label: 'Pressure sensor', x: 600, y: 0, conductors: ['SP', 'SN'] },
      ],
      wires: [
        { id: 'w1', a: { node: 'n1', terminal: 'top:AI1' }, b: { node: 'n2', terminal: 'top:1' } },
        { id: 'w2', a: { node: 'n1', terminal: 'top:AI1N' }, b: { node: 'n2', terminal: 'top:2' } },
        { id: 'w3', a: { node: 'n2', terminal: 'bottom:1b' }, b: { node: 'n3', terminal: 'top:SP' } },
        { id: 'w4', a: { node: 'n2', terminal: 'bottom:2b' }, b: { node: 'n3', terminal: 'top:SN' } },
      ],
    },
  },
};

const downloaded = (id) =>
  browser.evaluate(`(async () => {
    let blob = null; const create = URL.createObjectURL; URL.createObjectURL = (b) => { blob = b; return create(b); };
    const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {};
    document.getElementById(${JSON.stringify(id)}).click(); await new Promise((r) => setTimeout(r, 500));
    HTMLAnchorElement.prototype.click = click; URL.createObjectURL = create;
    return blob ? await blob.text() : null;
  })()`);

try {
  browser = await launch();
  await browser.goto(page);
  await browser.evaluate(`localStorage.setItem('eebox:tour-done', 'true')`);
  await browser.goto(page);
  await browser.resize(1516, 784);
  await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the palette');

  await step('the project opens with no warning about the wiring', async () => {
    await browser.evaluate(`(async () => {
      const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(JSON.stringify(project))}], 'signals.json'));
      const input = document.getElementById('open-project'); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 500));
      [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click();
    })()`);
    await browser.waitFor(`document.getElementById('status').textContent.includes('loaded')`, 'the project to load');
    const status = await browser.evaluate(`document.getElementById('status').textContent`);
    expectTrue(!/warning|problem/i.test(status), `the project loaded with a warning: ${status}`);
  });

  await step('the tables show the terminals of the strip, with where each side goes and the labels of the block', async () => {
    await browser.evaluate(`document.getElementById('view-tables').click()`);
    await browser.waitFor(`document.querySelector('dialog[open] .tables-tabs')`, 'the tables dialog');
    await browser.evaluate(`[...document.querySelectorAll('dialog[open] .tables-tabs button')].find((b) => b.textContent.startsWith('Terminals')).click()`);
    const text = await browser.evaluate(`document.querySelector('dialog[open]').innerText`);
    expectTrue(text.includes('X1') && text.includes('X1:1') && text.includes('Controller AI1 (top)') && text.includes('Pressure sensor SP (top)'), `the terminal table is wrong: ${text.slice(0, 400)}`);
    await browser.evaluate(`document.querySelector('dialog[open]').close()`);
  });

  await step('the terminal schedule is exported as a CSV with a header and a row for each way', async () => {
    const csv = await downloaded('export-terminals');
    expectTrue(csv !== null && csv.startsWith('Strip,Terminal,Conductor,Top connects to,Bottom connects to'), `the CSV has no header: ${csv}`);
    expectTrue(csv.includes('X1,X1:1,SP,Controller AI1 (top),Pressure sensor SP (top)'), `the first way is not in the CSV: ${csv}`);
  });

  await step('Check finds nothing wrong with the signal wiring', async () => {
    await browser.evaluate(`document.getElementById('check').click()`);
    await browser.waitFor(`document.getElementById('problems') && !document.getElementById('problems').hidden`, 'the problems panel');
    const text = await browser.evaluate(`document.getElementById('problems').innerText`);
    expectTrue(!/ERROR/.test(text), `Check reported an error: ${text}`);
  });

  expectTrue(browser.problems.length === 0, `the page raised errors: ${JSON.stringify(browser.problems)}`);
} finally {
  await browser?.close();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} step(s) failed`);
  process.exit(1);
}
console.log('\nsignals test passed');
