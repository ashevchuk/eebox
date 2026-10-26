/**
 * Smoke test in a real browser: it opens the built page from `file://`, as a user does, and walks
 * through the main flows. Run `npm run build:dist-file` first. No dependencies: a system Chrome or
 * Chromium and Node are enough.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from './browser.mjs';

const page = resolve('dist-file/index.html');
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

const expectEqual = (actual, wanted, what) => {
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${what}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`);
};
const expectTrue = (value, what) => {
  if (!value) throw new Error(what);
};

const clickButton = (text) =>
  browser.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().replace(/\\s*\\u25BE$/, '') === ${JSON.stringify(text)}); if (!b) throw new Error('no button ' + ${JSON.stringify(text)}); b.click(); })()`);

try {
  browser = await launch();
  await browser.goto(pathToFileURL(page).href);
  await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the bundled library in the palette');

  await step('the bundled library is in the palette and the page has no errors yet', async () => {
    expectTrue(await browser.evaluate(`document.querySelector('#palette .library-title')?.textContent.includes('Generic IEC')`), 'the bundled library is missing');
    expectEqual(browser.problems, [], 'errors in the page');
  });

  await step('menus open, show their items and close on Escape', async () => {
    await clickButton('File');
    expectTrue(await browser.evaluate(`!document.querySelectorAll('.menu-list')[0].hidden`), 'File did not open');
    expectTrue(await browser.evaluate(`document.getElementById('cable-settings') !== null`), 'File has no Cable settings');
    await browser.evaluate(`document.querySelectorAll('.menu')[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    expectTrue(await browser.evaluate(`document.querySelectorAll('.menu-list')[0].hidden`), 'Escape did not close the menu');
  });

  await step('a module is dragged from the palette onto the rail and is selected', async () => {
    const at = await browser.evaluate(`(async () => {
      const search = document.getElementById('palette-search');
      search.value = 'mcb 1p c16'; search.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      const r = document.querySelector('#palette .module').getBoundingClientRect();
      return [r.x + 20, r.y + r.height / 2];
    })()`);
    await browser.mouse('mousePressed', at[0], at[1]);
    await browser.mouse('mouseMoved', at[0] + 60, at[1] + 20);
    await browser.mouse('mouseMoved', 700, 400);
    await browser.mouse('mouseMoved', 640, 395);
    await browser.mouse('mouseReleased', 640, 395);
    await browser.waitFor(`document.getElementById('inspector').innerText.includes('MCB 1P C16')`, 'the placed module in the inspector');
  });

  await step('an example project opens and Check finds nothing wrong', async () => {
    await browser.evaluate(`(async () => {
      const file = new File([${JSON.stringify(example)}], 'house-panel.json');
      const data = new DataTransfer(); data.items.add(file);
      const input = document.getElementById('open-project'); input.files = data.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click();
    })()`);
    await browser.waitFor(`document.getElementById('status').textContent.includes('loaded')`, 'the project to load');
    await clickButton('Check');
    expectEqual(await browser.evaluate(`document.getElementById('status').textContent`), 'Check passed: no problems found.', 'Check');
  });

  await step('the schematic shows currents and the circuit list has its loads', async () => {
    await clickButton('Schematic');
    const csv = await browser.evaluate(`(async () => {
      let blob = null; const create = URL.createObjectURL; URL.createObjectURL = (b) => { blob = b; return create(b); };
      const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {};
      document.getElementById('export-circuits').click();
      await new Promise((r) => setTimeout(r, 300));
      HTMLAnchorElement.prototype.click = click; URL.createObjectURL = create;
      return blob ? blob.text() : null;
    })()`);
    expectTrue(csv?.includes('Kitchen sockets,3000,13'), 'the circuit list lacks the kitchen load');
    expectTrue(csv.includes('Ferrule (mm2),Quantity'), 'the circuit list lacks the ferrules');
  });

  await step('the print sheet holds the drawings and tables, and prints on a white ground', async () => {
    await browser.evaluate(`window.print = () => {}; document.getElementById('print').click()`);
    await browser.waitFor(`document.querySelectorAll('#print-sheet svg').length === 2`, 'two drawings on the print sheet');
    expectEqual(await browser.evaluate(`[...document.querySelectorAll('#print-sheet h2')].map((h) => h.textContent)`), ['Parts list', 'Circuits', 'Ferrules'], 'sections');
    await browser.media('print');
    const pdf = await browser.pdf();
    await browser.media('screen');
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expectTrue(pages >= 3, `expected at least 3 printed pages, got ${pages}`);
  });

  await step('the label sheet has a cell for every module and two markers for every cable', async () => {
    await browser.evaluate(`document.getElementById('print-labels').click()`);
    await browser.waitFor(`document.querySelectorAll('#print-sheet .strip-cell').length === 11`, 'eleven label cells');
    expectTrue(await browser.evaluate(`document.querySelectorAll('#print-sheet .marker').length >= 6`), 'cable markers are missing');
  });

  await step('the designer adds a terminal by a click, undoes it, and saves a module into My modules', async () => {
    await clickButton('Panel');
    await browser.evaluate(`document.getElementById('new-module').click()`);
    await browser.waitFor(`document.querySelector('.designer-dialog[open]')`, 'the designer');
    const before = await browser.evaluate(`document.querySelectorAll('.designer-pin').length`);
    const spot = await browser.evaluate(`(() => {
      const svg = document.querySelector('.designer-svg'); const body = svg.querySelector('rect');
      const r = svg.getBoundingClientRect(); const k = r.width / Number(svg.getAttribute('width'));
      return [r.left + (Number(body.getAttribute('x')) + Number(body.getAttribute('width')) / 2) * k, r.top + (Number(body.getAttribute('y')) + 30) * k];
    })()`);
    await browser.mouse('mousePressed', spot[0], spot[1]);
    await browser.mouse('mouseReleased', spot[0], spot[1]);
    await browser.waitFor(`document.querySelectorAll('.designer-pin').length === ${before + 1}`, 'the new terminal');
    await browser.evaluate(`[...document.querySelectorAll('.designer-dialog header button')].find((b) => b.textContent === 'Undo').click()`);
    expectEqual(await browser.evaluate(`document.querySelectorAll('.designer-pin').length`), before, 'terminals after undo');
    await browser.evaluate(`(() => {
      const row = [...document.querySelectorAll('.designer-fields .inspector-field')].find((r) => r.innerText.startsWith('Name'));
      const input = row.querySelector('input'); input.value = 'Smoke test module'; input.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('.designer-dialog button.primary').click();
    })()`);
    await browser.waitFor(`document.querySelector('.designer-dialog .editor-status')?.textContent.includes('Saved')`, 'the module to be saved');
    await browser.evaluate(`[...document.querySelectorAll('.designer-dialog header button')].find((b) => b.textContent === 'Close').click()`);
    await browser.evaluate(`(() => { const s = document.getElementById('palette-search'); s.value = 'smoke test'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await browser.waitFor(`document.querySelector('#palette .module')?.textContent.includes('Smoke test module')`, 'the new module in the palette');
  });

  await step('an example is chosen from the File menu and loads without problems', async () => {
    await clickButton('File');
    await browser.evaluate(`document.getElementById('open-example').click()`);
    await browser.waitFor(`document.querySelector('.examples-dialog[open]')`, 'the examples dialog');
    expectEqual(await browser.evaluate(`[...document.querySelectorAll('.example-item strong')].map((s) => s.textContent)`), ['Studio flat', 'House panel', 'Workshop with a backup input'], 'examples listed');
    await browser.evaluate(`[...document.querySelectorAll('.example-item')].find((b) => b.textContent.startsWith('Workshop')).click()`);
    await browser.evaluate(`(async () => { await new Promise((r) => setTimeout(r, 300)); [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click(); })()`);
    await browser.waitFor(`document.getElementById('status').textContent.includes('Workshop with a backup input loaded')`, 'the example to load');
    await clickButton('Check');
    expectEqual(await browser.evaluate(`document.getElementById('status').textContent`), 'Check passed: no problems found.', 'Check on the example');
  });

  await step('a source that is off leaves what it feeds dashed and dim in an exported drawing', async () => {
    const project = JSON.parse(example);
    project.project.schematic.nodes.find((n) => n.kind === 'source').off = true;
    await browser.evaluate(`(async () => {
      const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(JSON.stringify(project))}], 'off.json'));
      const input = document.getElementById('open-project'); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click();
    })()`);
    await browser.waitFor(`document.getElementById('status').textContent.includes('off.json loaded')`, 'the project to load');
    await clickButton('Schematic');
    const svg = await browser.evaluate(`(async () => {
      let blob = null; const create = URL.createObjectURL; URL.createObjectURL = (b) => { blob = b; return create(b); };
      const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {};
      document.getElementById('export-svg').click();
      await new Promise((r) => setTimeout(r, 400));
      HTMLAnchorElement.prototype.click = click; URL.createObjectURL = create;
      return blob ? blob.text() : null;
    })()`);
    expectTrue(svg?.includes('stroke-dasharray="3 5"'), 'no dead wire is dashed');
    expectTrue(/opacity="0\.45"/.test(svg), 'no dead node is dimmed');
  });

  await step('the page raised no errors during the whole run', async () => {
    expectEqual(browser.problems, [], 'errors in the page');
  });
} finally {
  await browser?.close();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} step(s) failed:\n${failures.map((f) => ` - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('\nsmoke test passed');
