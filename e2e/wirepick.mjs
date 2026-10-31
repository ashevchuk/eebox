/**
 * Wires that run on top of each other, in a real browser: a press on the grip of the chosen wire pulls that wire, not
 * the one that happens to lie over it (two hand-routed wires share a piece; the first is chosen on a part of its
 * own and its grip on the shared piece is pulled), and pulling one automatic wire of nine does not make the others jump. Run `npm run build:dist-file` first.
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

const route = [120, 250, 200];
const project = {
  format: 'eebox-project',
  version: 1,
  project: {
    panel: { plates: [{ id: 'plate1', name: 'Back plate', widthMm: 210, heightMm: 220 }], rails: [{ plate: 'plate1', x: 0, y: 110, lengthUnits: 12 }], placements: [], combs: [], shelf: [] },
    schematic: {
      nodes: [
        { id: 'n1', kind: 'source', label: 'Mains', x: 0, y: 0, conductors: ['L1', 'L2'] },
        { id: 'n2', kind: 'load', label: 'Load', x: 400, y: 300, conductors: ['L1', 'L2'] },
      ],
      wires: [
        { id: 'w1', a: { node: 'n1', terminal: 'bottom:L1' }, b: { node: 'n2', terminal: 'top:L1' }, route },
        { id: 'w2', a: { node: 'n1', terminal: 'bottom:L2' }, b: { node: 'n2', terminal: 'top:L2' }, route },
      ],
    },
  },
  modules: {},
};
const routes = () =>
  browser.evaluate(`(async () => { await new Promise((r) => setTimeout(r, 1100)); return Object.fromEntries(JSON.parse(localStorage.getItem('eebox:autosave')).project.schematic.wires.map((w) => [w.id, w.route])); })()`);

try {
  browser = await launch();
  await browser.goto(page);
  await browser.evaluate(`localStorage.setItem('eebox:tour-done', 'yes')`);
  await browser.goto(page);
  await browser.resize(1516, 784);
  await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the palette');
  await browser.evaluate(`(async () => {
    const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(JSON.stringify(project))}], 'overlap.json'));
    const input = document.getElementById('open-project'); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click();
  })()`);
  await browser.waitFor(`document.getElementById('status').textContent.includes('loaded')`, 'the project to load');
  await browser.evaluate(`document.getElementById('mode-schematic').click()`);
  await wait(600);
  await browser.evaluate(`document.getElementById('fit').click()`);
  await wait(500);

  await step('pulling the grip of the chosen wire where another lies over it moves the chosen wire and not the other', async () => {
    const before = await routes();
    await browser.mouse('mousePressed', 287, 290);
    await browser.mouse('mouseReleased', 287, 290);
    await wait(300);
    expectTrue(/Wire/.test(await browser.evaluate(`document.getElementById('inspector').innerText`)), 'no wire was chosen');
    await browser.mouse('mousePressed', 615, 405);
    for (const dx of [10, 25, 40, 60]) {
      await browser.mouse('mouseMoved', 615 + dx, 405);
      await wait(40);
    }
    await browser.mouse('mouseReleased', 675, 405);
    await wait(500);
    const after = await routes();
    expectTrue(JSON.stringify(after.w1) !== JSON.stringify(before.w1), `the chosen wire did not move: ${JSON.stringify(after.w1)}`);
    expectTrue(JSON.stringify(after.w2) === JSON.stringify(before.w2), `the other wire moved too: ${JSON.stringify(before.w2)} -> ${JSON.stringify(after.w2)}`);
  });

  await step('pulling one automatic wire of nine does not make the others jump about', async () => {
    const lib = 'generic-iec';
    const placement = (id, moduleId, slot) => ({ id, module: { libraryId: lib, moduleId }, rail: 0, slot });
    const wires = [];
    for (const k of ['1', '2', '3']) {
      for (const [a, b] of [['n1', 'n2'], ['n2', 'n3'], ['n1', 'n3']]) wires.push({ id: `w${wires.length + 1}`, a: { node: a, terminal: `bottom:T${k}` }, b: { node: b, terminal: `top:L${k}` } });
    }
    const contactors = {
      format: 'eebox-project',
      version: 1,
      project: {
        panel: { plates: [{ id: 'plate1', name: 'Back plate', widthMm: 420, heightMm: 220 }], rails: [{ plate: 'plate1', x: 0, y: 110, lengthUnits: 24 }], placements: [placement('p1', 'contactor-3p-20-230', 0), placement('p2', 'contactor-3p-25-230', 4), placement('p3', 'contactor-3p-20-230', 8)], combs: [], shelf: [] },
        schematic: {
          nodes: [
            { id: 'n1', kind: 'module', label: 'K1', x: 0, y: 0, placementId: 'p1' },
            { id: 'n2', kind: 'module', label: 'K2', x: 420, y: 0, placementId: 'p2' },
            { id: 'n3', kind: 'module', label: 'K3', x: 840, y: 0, placementId: 'p3' },
          ],
          wires,
        },
      },
      modules: {},
    };
    await browser.evaluate(`(async () => {
      const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(JSON.stringify(contactors))}], 'contactors.json'));
      const input = document.getElementById('open-project'); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 600));
      [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click();
      await new Promise((r) => setTimeout(r, 500));
    })()`);
    await browser.evaluate(`document.getElementById('mode-schematic').click()`);
    await wait(600);
    await browser.evaluate(`document.getElementById('fit').click()`);
    await wait(500);
    const paths = () =>
      browser.evaluate(`(async () => {
        let blob = null; const create = URL.createObjectURL; URL.createObjectURL = (b) => { blob = b; return create(b); };
        const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {};
        document.getElementById('export-svg').click(); await new Promise((r) => setTimeout(r, 700));
        HTMLAnchorElement.prototype.click = click; URL.createObjectURL = create;
        const text = blob ? await blob.text() : '';
        return [...text.matchAll(/<path d="([^"]+)"[^>]*?stroke="(#(?:ffd700|008000|ff0000))"/g)].map((m) => m[2] + ' ' + m[1]);
      })()`);
    const before = await paths();
    expectTrue(before.length === 9, `${before.length} wires are drawn, not nine`);
    await browser.mouse('mousePressed', 400, 482);
    await browser.mouse('mouseReleased', 400, 482);
    await wait(300);
    await browser.mouse('mousePressed', 400, 482);
    for (const dy of [10, 25, 45, 70, 90]) {
      await browser.mouse('mouseMoved', 400, 482 + dy);
      await wait(40);
    }
    await browser.mouse('mouseReleased', 400, 572);
    await wait(500);
    const after = await paths();
    const moved = before.filter((p) => !after.includes(p)).length;
    expectTrue(moved >= 1, 'the wire that was pulled did not move');
    // The one that is pulled, and at most one whose path a route cannot draw as it is; without holding, all nine moved.
    expectTrue(moved <= 2, `${moved} of nine wires moved when one was pulled`);
  });

  expectTrue(browser.problems.length === 0, `the page raised errors: ${JSON.stringify(browser.problems)}`);
} finally {
  await browser?.close();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} step(s) failed`);
  process.exit(1);
}
console.log('\nwire pick test passed');
