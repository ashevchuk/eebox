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
const partsCsv = readFileSync(resolve('examples/parts.csv'), 'utf8');
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

  await step('a placed module is duplicated, everything is selected and then deleted from the keyboard', async () => {
    const press = (code, ctrl) =>
      browser.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { code: '${code}', ctrlKey: ${ctrl}, bubbles: true }))`);
    const inspectorText = () => browser.evaluate(`document.getElementById('inspector').innerText`);
    await press('KeyD', true);
    await browser.waitFor(`document.getElementById('inspector').innerText.includes('p2')`, 'the copy to be selected');
    await press('KeyA', true);
    await browser.waitFor(`document.getElementById('inspector').innerText.includes('2 items selected')`, 'both modules to be selected');
    await press('Delete', false);
    await browser.waitFor(`!document.getElementById('inspector').innerText.includes('items selected')`, 'the selection to go');
    expectTrue(!(await inspectorText()).includes('MCB 1P C16'), 'the modules to be gone');
  });

  await step('two modules are selected with a rubber band and moved together', async () => {
    const dropModule = async (x) => {
      const at = await browser.evaluate(`(async () => {
        const search = document.getElementById('palette-search');
        search.value = 'mcb 1p c16'; search.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 300));
        const r = document.querySelector('#palette .module').getBoundingClientRect();
        return [r.x + 20, r.y + r.height / 2];
      })()`);
      await browser.mouse('mousePressed', at[0], at[1]);
      await browser.mouse('mouseMoved', at[0] + 60, at[1] + 20);
      await browser.mouse('mouseMoved', x + 40, 400);
      await browser.mouse('mouseMoved', x, 395);
      await browser.mouse('mouseReleased', x, 395);
    };
    const slots = () =>
      browser.evaluate(`(async () => {
        await new Promise((r) => setTimeout(r, 1200));
        const file = JSON.parse(localStorage.getItem('eebox:autosave'));
        return file.project.panel.placements.map((p) => p.slot);
      })()`);
    await dropModule(640);
    await dropModule(760);
    const before = await slots();
    expectEqual(before.length, 2, 'two modules placed');
    await browser.mouse('mousePressed', 520, 160, 8);
    await browser.mouse('mouseMoved', 900, 400, 8);
    await browser.mouse('mouseMoved', 1300, 650, 8);
    await browser.mouse('mouseReleased', 1300, 650, 8);
    await browser.waitFor(`document.getElementById('inspector').innerText.includes('2 items selected')`, 'the band to select both');
    await browser.mouse('mousePressed', 640, 395);
    await browser.mouse('mouseMoved', 660, 395);
    await browser.mouse('mouseMoved', 700, 395);
    await browser.mouse('mouseReleased', 700, 395);
    const after = await slots();
    expectTrue(after.every((slot, i) => slot > before[i]), `both modules to move right, were ${before} now ${after}`);
    expectTrue(Math.abs(after[1] - after[0] - (before[1] - before[0])) < 1e-6, 'the distance between them to stay');
  });

  await step('the ruler is switched on with R, a drag measures without changing the project, Escape switches it off', async () => {
    const key = (code) => browser.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { code: '${code}', bubbles: true }))`);
    const modules = () => browser.evaluate(`(async () => { await new Promise((r) => setTimeout(r, 1300)); return JSON.stringify(JSON.parse(localStorage.getItem('eebox:autosave')).project.panel.placements); })()`);
    const before = await modules();
    await key('KeyR');
    expectEqual(await browser.evaluate(`document.getElementById('ruler').classList.contains('active')`), true, 'ruler button after R');
    await browser.mouse('mousePressed', 600, 300); await browser.mouse('mouseMoved', 700, 350); await browser.mouse('mouseMoved', 800, 420); await browser.mouse('mouseReleased', 800, 420);
    await key('Escape');
    expectEqual(await browser.evaluate(`document.getElementById('ruler').classList.contains('active')`), false, 'ruler button after Escape');
    expectEqual(await modules(), before, 'modules after measuring');
  });

  await step('copies of the selected modules are added edge to edge from the inspector', async () => {
    await browser.evaluate(`(() => {
      const row = [...document.querySelectorAll('#inspector .inspector-field')].find((r) => r.querySelector('label').textContent === 'Add copies');
      const input = row.querySelector('input'); input.value = '4'; input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await browser.waitFor(`document.getElementById('status').textContent.includes('Added 4 copies')`, 'the message about the copies');
    await browser.waitFor(`document.getElementById('inspector').innerText.includes('8 items selected')`, 'all the copies to be selected');
  });

  await step('a parts list in CSV is imported as a library with a 22.5 mm relay in it', async () => {
    await browser.evaluate(`(async () => {
      const file = new File([${JSON.stringify(partsCsv)}], 'parts.csv');
      const data = new DataTransfer(); data.items.add(file);
      const input = document.getElementById('import'); input.files = data.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await browser.waitFor(`document.getElementById('status').textContent.includes('Imported "parts"')`, 'the import message');
    const search = `(async () => {
      const box = document.getElementById('palette-search');
      box.value = 'relay 1co'; box.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      return document.getElementById('palette').innerText;
    })()`;
    expectTrue((await browser.evaluate(search)).includes('Relay 1CO 22.5 mm'), 'the relay from the table in the palette');
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
    expectEqual(await browser.evaluate(`[...document.querySelectorAll('#print-sheet h2')].map((h) => h.textContent)`), ['Parts list', 'Circuits', 'Connections', 'Ferrules'], 'sections');
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

  await step('the full-size print cuts the panel into A4 sheets, one printed page each, at true size', async () => {
    await clickButton('Panel');
    await browser.evaluate(`window.print = () => {}; document.getElementById('print-full-size').click()`);
    await browser.waitFor(`document.querySelectorAll('#print-sheet .tile').length >= 2`, 'several sheets');
    const sheets = await browser.evaluate(`document.querySelectorAll('#print-sheet .tile').length`);
    await browser.media('print');
    const measured = await browser.evaluate(`(() => {
      const svg = document.querySelector('#print-sheet .tile-drawing svg');
      const wanted = parseFloat(svg.style.width);
      return { wanted, actual: svg.getBoundingClientRect().width / (96 / 25.4) };
    })()`);
    const pdf = await browser.pdf();
    await browser.media('screen');
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expectEqual(pages, sheets, 'printed pages');
    expectTrue(Math.abs(measured.actual - measured.wanted) < 0.5, `drawing is ${measured.actual} mm wide, wanted ${measured.wanted}`);
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

  await step('the designer builds a distribution block of one input and six outputs, with a variant for each conductor', async () => {
    await browser.evaluate(`document.getElementById('new-module').click()`);
    await browser.waitFor(`document.querySelector('.designer-dialog[open]')`, 'the designer');
    await browser.evaluate(`(() => {
      const field = (t) => [...document.querySelectorAll('.designer-fields .inspector-field')].find((r) => r.innerText.startsWith(t)).querySelector('input,select');
      for (const [label, value] of [['Name', 'Block 125'], ['Kind', 'terminal'], ['Width', '2']]) { const f = field(label); f.value = value; f.dispatchEvent(new Event('change', { bubbles: true })); }
      [...document.querySelectorAll('.designer-toolbar button')].find((b) => b.textContent === 'Block…').click();
    })()`);
    await browser.waitFor(`document.querySelector('.designer-dialog dialog[open]')`, 'the block dialog');
    await browser.evaluate(`(() => {
      const d = document.querySelector('.designer-dialog dialog'); const c = [...d.querySelectorAll('label input, label select')];
      c[0].value = '1'; c[1].value = '6'; c[2].value = 'N'; c[3].checked = true;
      [...d.querySelectorAll('button')].find((b) => b.textContent === 'OK').click();
    })()`);
    await browser.waitFor(`document.querySelectorAll('.designer-pin').length === 7`, 'seven terminals');
    expectEqual(await browser.evaluate(`document.querySelector('.designer-dialog .editor-errors').textContent`), '', 'problems with the block');
    await browser.evaluate(`[...document.querySelectorAll('.designer-toolbar button')].find((b) => b.textContent === 'Variants…').click()`);
    await browser.waitFor(`document.querySelector('.designer-dialog dialog[open] input')`, 'the variants dialog');
    await browser.evaluate(`(() => {
      const d = document.querySelector('.designer-dialog dialog'); d.querySelectorAll('input')[2].value = 'L1 L2 L3 N PE';
      [...d.querySelectorAll('button')].find((b) => b.textContent === 'Make variants').click();
    })()`);
    await browser.waitFor(`document.querySelector('.designer-dialog .editor-status')?.textContent.includes('Made 5 variants')`, 'five variants');
    expectEqual(await browser.evaluate(`document.querySelector('.designer-dialog .editor-errors').textContent`), '', 'problems with the variants');
    await browser.evaluate(`[...document.querySelectorAll('.designer-dialog header button')].find((b) => b.textContent === 'Close').click()`);
    await browser.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click()`);
  });

  await step('an example is chosen from the File menu and loads without problems', async () => {
    await clickButton('File');
    await browser.evaluate(`document.getElementById('open-example').click()`);
    await browser.waitFor(`document.querySelector('.examples-dialog[open]')`, 'the examples dialog');
    expectEqual(await browser.evaluate(`[...document.querySelectorAll('.example-item strong')].map((s) => s.textContent)`), ['Studio flat', 'House panel', 'Workshop with a backup input', 'Automatic backup with a transfer controller'], 'examples listed');
    await browser.evaluate(`[...document.querySelectorAll('.example-item')].find((b) => b.textContent.startsWith('Workshop')).click()`);
    await browser.evaluate(`(async () => { await new Promise((r) => setTimeout(r, 300)); [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click(); })()`);
    await browser.waitFor(`document.getElementById('status').textContent.includes('Workshop with a backup input loaded')`, 'the example to load');
    await clickButton('Check');
    expectEqual(await browser.evaluate(`document.getElementById('status').textContent`), 'Check passed: no problems found.', 'Check on the example');
  });

  await step('no text is cut off or sticks out of the window in the toolbar, the sidebars and the dialogs', async () => {
    const scan = `(() => {
      const out = [];
      const W = window.innerWidth, H = window.innerHeight;
      for (const el of document.querySelectorAll('body *')) {
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || el.closest('#print-sheet') || el.closest('svg') || el.tagName === 'CANVAS') continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!own) continue;
        const scrolls = (() => { for (let a = el.parentElement; a; a = a.parentElement) { const o = getComputedStyle(a).overflowY; if (o === 'auto' || o === 'scroll') return true; } return false; })();
        const clipped = st.overflowX !== 'visible' && st.overflowX !== 'auto' && st.overflowX !== 'scroll' && el.scrollWidth > el.clientWidth + 1;
        const outside = !scrolls && (r.right > W + 1 || r.bottom > H + 1 || r.left < -1);
        if (clipped || outside) out.push(el.tagName + ' "' + el.textContent.trim().slice(0, 40) + '"');
      }
      return out;
    })()`;
    await clickButton('Check');
    expectEqual(await browser.evaluate(scan), [], 'cut off or overflowing text in the main window');
    await clickButton('File');
    await browser.evaluate(`document.getElementById('cable-settings').click()`);
    await browser.waitFor(`document.querySelector('dialog[open]')`, 'the cable settings dialog');
    expectEqual(await browser.evaluate(scan), [], 'cut off or overflowing text in the cable settings');
    await browser.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Cancel').click()`);
  });

  await step('the cable settings form outlines a changed cell, refuses a wrong one and exports a file', async () => {
    await clickButton('File');
    await browser.evaluate(`document.getElementById('cable-settings').click()`);
    await browser.waitFor(`document.querySelector('dialog[open] .settings-table')`, 'the cable settings form');
    const type = (index, value) => browser.evaluate(`(() => { const i = document.querySelectorAll('dialog[open] .settings-table input')[${index}]; i.value = '${value}'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const state = () => browser.evaluate(`({ changed: document.querySelectorAll('dialog[open] input.changed').length, invalid: document.querySelectorAll('dialog[open] input.invalid').length, save: [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Save').disabled })`);
    await type(10, '29');
    expectEqual(await state(), { changed: 1, invalid: 0, save: false }, 'after a valid edit');
    await type(12, '1');
    expectEqual((await state()).save, true, 'Save with a wrong cell');
    await browser.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Reset to built-in values').click()`);
    expectEqual(await state(), { changed: 0, invalid: 0, save: false }, 'after the reset');
    await browser.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Cancel').click()`);
  });

  await step('the colours of the conductors are chosen in a dialog, saved, and used by the exports', async () => {
    await clickButton('File');
    await browser.evaluate(`document.getElementById('colour-scheme').click()`);
    await browser.waitFor(`document.querySelector('dialog[open] .colours-table')`, 'the colours dialog');
    expectEqual(await browser.evaluate(`document.querySelectorAll('dialog[open] .colours-table tbody tr').length`), 9, 'one row for each conductor');
    await browser.evaluate(`(() => { const s = document.querySelector('dialog[open] select'); s.value = 'pue'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await browser.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Save').click()`);
    expectEqual(await browser.evaluate(`JSON.parse(localStorage.getItem('eebox:colour-scheme')).scheme`), 'pue', 'stored scheme');
    await clickButton('Schematic');
    const svg = await browser.evaluate(`(async () => {
      let blob = null; const create = URL.createObjectURL; URL.createObjectURL = (b) => { blob = b; return create(b); };
      const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {};
      document.getElementById('export-svg').click(); await new Promise((r) => setTimeout(r, 400));
      HTMLAnchorElement.prototype.click = click; URL.createObjectURL = create; return await blob.text();
    })()`);
    expectTrue(svg.includes('#e3bd0b') && svg.includes('#d62828'), 'the exported drawing does not use the PUE colours');
    await browser.evaluate(`(() => { document.getElementById('colour-scheme').click(); })()`);
    await browser.waitFor(`document.querySelector('dialog[open] .colours-table')`, 'the colours dialog again');
    await browser.evaluate(`(() => { const s = document.querySelector('dialog[open] select'); s.value = 'eu'; s.dispatchEvent(new Event('change', { bubbles: true })); [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Save').click(); })()`);
    await clickButton('Panel');
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
