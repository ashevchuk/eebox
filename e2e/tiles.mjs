/**
 * The full-size print of a panel with two plates, in a real browser: both plates are printed, the
 * sheets are numbered across them, and the plate on view stays the one that was on view. Run
 * `npm run build:dist-file` first.
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

const device = { id: 'dev', kind: 'plc', name: 'Controller', widthUnits: 4, heightMm: 90, mounting: 'both', poles: 1, terminals: [{ name: 'A', conductor: 'SP', side: 'top', unit: 0 }] };
const project = {
  format: 'eebox-project',
  version: 1,
  modules: { 'lib/dev': device },
  project: {
    panel: {
      title: 'Two plates',
      plates: [
        { id: 'plate1', name: 'Back plate', widthMm: 300, heightMm: 300 },
        { id: 'plate2', name: 'Door', widthMm: 300, heightMm: 300 },
      ],
      rails: [{ plate: 'plate1', orientation: 'horizontal', x: 0, y: 110, lengthUnits: 12 }],
      placements: [
        { id: 'p1', module: { libraryId: 'lib', moduleId: 'dev' }, rail: 0, slot: 0 },
        { id: 'p2', module: { libraryId: 'lib', moduleId: 'dev' }, plate: 'plate2', x: 40, y: 60 },
      ],
      combs: [],
      shelf: [],
    },
    schematic: { nodes: [], wires: [] },
  },
};

try {
  browser = await launch();
  await browser.goto(page);
  await browser.evaluate(`localStorage.setItem('eebox:tour-done', 'yes')`);
  await browser.goto(page);
  await browser.resize(1516, 784);
  await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the palette');
  await browser.evaluate(`(async () => {
    const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(JSON.stringify(project))}], 'two-plates.json'));
    const input = document.getElementById('open-project'); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click();
  })()`);
  await browser.waitFor(`document.getElementById('status').textContent.includes('loaded')`, 'the project to load');

  await step('the full-size print holds sheets of both plates, numbered across them', async () => {
    await browser.evaluate(`window.print = () => {}; document.getElementById('print-full-size').click()`);
    await browser.waitFor(`document.querySelectorAll('#print-sheet .tile').length >= 2`, 'sheets');
    const captions = await browser.evaluate(`[...document.querySelectorAll('#print-sheet .tile-caption')].map((c) => c.textContent)`);
    expectTrue(captions.some((c) => c.includes('Back plate')), `no sheet of the back plate: ${captions}`);
    expectTrue(captions.some((c) => c.includes('Door')), `no sheet of the door: ${captions}`);
    captions.forEach((caption, index) => expectTrue(caption.includes(`sheet ${index + 1} of ${captions.length}`), `sheet ${index + 1} is numbered wrong: ${caption}`));
  });

  await step('the plate on view is still the first one after the print', async () => {
    const active = await browser.evaluate(`document.querySelector('.plate-tab.active').textContent`);
    expectTrue(active === 'Back plate', `the plate on view changed to ${active}`);
  });

  expectTrue(browser.problems.length === 0, `the page raised errors: ${JSON.stringify(browser.problems)}`);
} finally {
  await browser?.close();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} step(s) failed`);
  process.exit(1);
}
console.log('\ntiles test passed');
