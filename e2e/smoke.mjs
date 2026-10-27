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

  await step('a first visit starts the tour, which walks through its steps and is not shown again once it is skipped', async () => {
    await browser.waitFor(`!document.getElementById('tour').hidden`, 'the tour on a first visit');
    const first = await browser.evaluate(`document.querySelector('#tour strong').textContent`);
    expectTrue(first.startsWith('1 of'), `the tour starts at ${first}`);
    await browser.evaluate(`[...document.querySelectorAll('#tour button')].find((b) => b.textContent === 'Next').click()`);
    expectTrue(await browser.evaluate(`document.getElementById('sidebar').classList.contains('tour-target')`), 'the second step does not point at the library');
    await browser.evaluate(`[...document.querySelectorAll('#tour button')].find((b) => b.textContent === 'Back').click()`);
    expectTrue((await browser.evaluate(`document.querySelector('#tour strong').textContent`)).startsWith('1 of'), 'Back did not go back');
    await browser.evaluate(`[...document.querySelectorAll('#tour button')].find((b) => b.textContent === 'Skip').click()`);
    expectEqual(await browser.evaluate(`document.getElementById('tour').hidden && !document.querySelector('.tour-target')`), true, 'the tour and its pointer after Skip');
    expectEqual(await browser.evaluate(`localStorage.getItem('eebox:tour-done')`), 'yes', 'the tour is remembered');
  });

  await step('the bundled library is in the palette and the page has no errors yet', async () => {
    expectTrue(await browser.evaluate(`document.querySelector('#palette .library-title')?.textContent.includes('Generic IEC')`), 'the bundled library is missing');
    expectEqual(browser.problems, [], 'errors in the page');
  });

  await step('the bundled font is loaded, so drawings look the same on every machine', async () => {
    await browser.waitFor(`[...document.fonts].filter((f) => f.family.replace(/["']/g, '') === 'eebox-sans' && f.status === 'loaded').length === 2`, 'both weights of the bundled font');
    expectTrue(await browser.evaluate(`document.fonts.check('bold 8px "eebox-sans"') && document.fonts.check('8px "eebox-sans"')`), 'the font to be usable');
  });

  await step('every module of the palette has a picture of its face, and none of them is larger than its box', async () => {
    const drawn = await browser.evaluate(`(() => {
      const canvases = [...document.querySelectorAll('#palette .module-thumbnail canvas')];
      const painted = canvases.filter((c) => c.width > 0 && c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0));
      const oversize = canvases.filter((c) => c.getBoundingClientRect().width > 36 || c.getBoundingClientRect().height > 36);
      return { canvases: canvases.length, painted: painted.length, oversize: oversize.length };
    })()`);
    expectTrue(drawn.canvases > 0, 'no pictures in the palette');
    expectEqual(drawn.painted, drawn.canvases, 'the pictures with something on them: all, the combs too');
    expectEqual(drawn.oversize, 0, 'pictures that stick out of their box and cover what lies beside them');
  });

  await step('the list of keys opens from its button and from the question mark, and closes', async () => {
    await browser.evaluate(`document.getElementById('help').click()`);
    await browser.waitFor(`document.querySelector('dialog.help-dialog[open]')`, 'the list of keys');
    expectEqual(await browser.evaluate(`[...document.querySelectorAll('dialog.help-dialog h3')].map((h) => h.textContent)`), ['Everywhere', 'Panel', 'Schematic', 'Module designer, Face'], 'the groups of keys');
    expectTrue(await browser.evaluate(`document.querySelectorAll('dialog.help-dialog kbd').length > 15`), 'the keys');
    await browser.evaluate(`[...document.querySelectorAll('dialog.help-dialog button')].find((b) => b.textContent === 'Close').click()`);
    await browser.waitFor(`!document.querySelector('dialog.help-dialog')`, 'the list to close');
    await browser.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', code: 'Slash', shiftKey: true, bubbles: true }))`);
    await browser.waitFor(`document.querySelector('dialog.help-dialog[open]')`, 'the list from the key');
    await browser.evaluate(`document.querySelector('dialog.help-dialog').close()`);
  });

  await step('an empty panel says what to do, in the middle of the drawing', async () => {
    const lit = () => browser.evaluate(`(() => {
      const c = document.getElementById('stage'); const w = c.width, h = c.height; const ctx = c.getContext('2d');
      const data = ctx.getImageData(Math.round(w / 2 - 120), Math.round(h / 2 - 30), 240, 60).data;
      let bright = 0; for (let i = 0; i < data.length; i += 4) if (data[i] > 150 && data[i + 1] > 150 && data[i + 2] > 150) bright++;
      return bright;
    })()`);
    expectTrue((await lit()) > 100, 'no words in the middle of the empty panel');
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

  await step('the library and the inspector can be hidden to give the drawing room, and come back', async () => {
    const hidden = (name) => browser.evaluate(`document.body.classList.contains('hide-${name}')`);
    const wide = await browser.evaluate(`document.getElementById('stage-wrap').clientWidth`);
    await browser.evaluate(`document.getElementById('toggle-inspector').click()`);
    expectEqual(await hidden('inspector'), true, 'inspector hidden');
    expectTrue((await browser.evaluate(`document.getElementById('stage-wrap').clientWidth`)) > wide, 'the drawing did not get wider');
    await browser.evaluate(`document.getElementById('toggle-inspector').click()`);
    expectEqual(await hidden('inspector'), false, 'inspector shown again');
    expectEqual(await browser.evaluate(`document.getElementById('stage-wrap').clientWidth`), wide, 'width after showing it again');
  });

  await step('the schematic menu separates wires that run close and takes hand-drawn routes off', async () => {
    const choose = async (item) => {
      await clickButton('Nodes');
      await browser.evaluate(`[...document.querySelectorAll('.menu-item')].find((b) => b.textContent.trim() === ${JSON.stringify(item)}).click()`);
    };
    const status = () => browser.evaluate(`document.getElementById('status').textContent`);
    await choose('Separate overlapping wires');
    expectEqual(await status(), 'No wires lie on top of each other.', 'status after separating wires of the example');
    await choose('Route all wires automatically');
    expectEqual(await status(), 'No wire has a route drawn by hand.', 'status after routing automatically');
  });

  await step('the print sheet holds the drawings and tables, and prints on a white ground', async () => {
    await browser.evaluate(`window.print = () => {}; document.getElementById('print').click(); new Promise((r) => setTimeout(r, 200)).then(() => [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Print').click())`);
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
    await browser.waitFor(`!document.querySelector('.designer-dialog[open]')`, 'the first designer to close');
    await browser.evaluate(`document.getElementById('new-module').click()`);
    await browser.waitFor(`[...document.querySelectorAll('.designer-dialog[open] .designer-toolbar button')].some((b) => b.textContent === 'Block…')`, 'the designer');
    await browser.evaluate(`(() => {
      const field = (t) => [...document.querySelectorAll('.designer-fields .inspector-field')].find((r) => r.innerText.startsWith(t)).querySelector('input,select');
      for (const [label, value] of [['Name', 'Block 125'], ['Kind', 'terminal'], ['Width', '2']]) { const f = field(label); f.value = value; f.dispatchEvent(new Event('change', { bubbles: true })); }
      [...document.querySelectorAll('.designer-toolbar button')].find((b) => b.textContent === 'Block…').click();
    })()`);
    await browser.waitFor(`document.querySelector('.designer-dialog dialog[open]')`, 'the block dialog');
    await browser.evaluate(`(() => {
      const d = document.querySelector('.designer-dialog dialog[open]'); const c = [...d.querySelectorAll('label input, label select')];
      c[0].value = '1'; c[1].value = '6'; c[2].value = 'N'; c[3].checked = true;
      [...d.querySelectorAll('button')].find((b) => b.textContent === 'OK').click();
    })()`);
    await browser.waitFor(`document.querySelectorAll('.designer-pin').length === 7`, 'seven terminals');
    expectEqual(await browser.evaluate(`document.querySelector('.designer-dialog .editor-errors').textContent`), '', 'problems with the block');
    await browser.evaluate(`[...document.querySelectorAll('.designer-toolbar button')].find((b) => b.textContent === 'Variants…').click()`);
    await browser.waitFor(`[...document.querySelectorAll('.designer-dialog dialog[open] button')].some((b) => b.textContent === 'Make variants')`, 'the variants dialog');
    await browser.evaluate(`(() => {
      const d = document.querySelector('.designer-dialog dialog[open]'); d.querySelectorAll('input')[2].value = 'L1 L2 L3 N PE';
      [...d.querySelectorAll('button')].find((b) => b.textContent === 'Make variants').click();
    })()`);
    await browser.waitFor(`document.querySelector('.designer-dialog .editor-status')?.textContent.includes('Made 5 variants')`, 'five variants');
    expectEqual(await browser.evaluate(`document.querySelector('.designer-dialog .editor-errors').textContent`), '', 'problems with the variants');
    await browser.evaluate(`[...document.querySelectorAll('.designer-dialog header button')].find((b) => b.textContent === 'Close').click()`);
    await browser.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click()`);
  });

  await step('the earthing system chosen for a source gives it the conductors of that system', async () => {
    await clickButton('Schematic');
    await clickButton('Nodes');
    await browser.evaluate(`document.getElementById('add-source3').click()`);
    await browser.waitFor(`[...document.querySelectorAll('#inspector .inspector-field')].some((r) => r.querySelector('label').textContent === 'Earthing')`, 'the earthing field');
    const choose = (system) => browser.evaluate(`(() => {
      const row = [...document.querySelectorAll('#inspector .inspector-field')].find((r) => r.querySelector('label').textContent === 'Earthing');
      const select = row.querySelector('select'); select.value = ${JSON.stringify(system)}; select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    const ticked = () => browser.evaluate(`[...[...document.querySelectorAll('#inspector .inspector-field')].find((r) => r.querySelector('label').textContent === 'Conductors').querySelectorAll('input:checked')].map((b) => b.parentElement.textContent.trim())`);
    await choose('TN-C-S');
    await browser.waitFor(`[...document.querySelectorAll('#inspector input:checked')].some((b) => b.parentElement.textContent.trim() === 'PEN')`, 'the PEN conductor to be ticked');
    expectEqual(await ticked(), ['L1', 'L2', 'L3', 'PEN'], 'the conductors of TN-C-S');
    await choose('TT');
    await browser.waitFor(`![...document.querySelectorAll('#inspector input:checked')].some((b) => b.parentElement.textContent.trim() === 'PEN')`, 'the PEN conductor to be unticked');
    expectEqual(await ticked(), ['L1', 'L2', 'L3', 'N', 'PE'], 'the conductors of TT');
    await clickButton('Panel');
  });

  await step('the designer draws on the face of a module and keeps the drawing with the module', async () => {
    await browser.waitFor(`!document.querySelector('.designer-dialog[open]')`, 'the earlier designer to close');
    await browser.evaluate(`document.getElementById('new-module').click()`);
    await browser.waitFor(`[...document.querySelectorAll('.designer-dialog[open] .designer-modes button')].some((b) => b.textContent === 'Face')`, 'the designer');
    await browser.evaluate(`(() => {
      const row = [...document.querySelectorAll('.designer-dialog[open] .designer-fields .inspector-field')].find((r) => r.innerText.startsWith('Name'));
      const input = row.querySelector('input'); input.value = 'Face test'; input.dispatchEvent(new Event('change', { bubbles: true }));
      const width = [...document.querySelectorAll('.designer-dialog[open] .designer-fields .inspector-field')].find((r) => r.innerText.startsWith('Width') && !r.innerText.startsWith('Width, mm')).querySelector('input');
      width.value = '3'; width.dispatchEvent(new Event('change', { bubbles: true }));
      [...document.querySelectorAll('.designer-dialog[open] .designer-modes button')].find((b) => b.textContent === 'Face').click();
    })()`);
    await browser.waitFor(`document.querySelector('.designer-dialog[open] .face-stage svg')`, 'the face');
    const tool = (name) => browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] .face-stage .designer-toolbar button')].find((b) => b.textContent === ${JSON.stringify(name)}).click()`);
    /** A point on the face, in millimetres from its corner, as a position on the screen. */
    const at = (x, y) => browser.evaluate(`(() => {
      const svg = document.querySelector('.designer-dialog[open] .face-stage svg'); const r = svg.getBoundingClientRect();
      const k = r.width / svg.width.baseVal.value; const scale = (svg.width.baseVal.value - 24) / 52.5;
      return [r.left + (12 + ${x} * scale) * k, r.top + (12 + ${y} * scale) * k];
    })()`);
    const drag = async (from, to) => {
      const [x1, y1] = await at(...from); const [x2, y2] = await at(...to);
      await browser.mouse('mouseMoved', x1, y1);
      await browser.mouse('mousePressed', x1, y1);
      await browser.mouse('mouseMoved', (x1 + x2) / 2, (y1 + y2) / 2);
      await browser.mouse('mouseMoved', x2, y2);
      await browser.mouse('mouseReleased', x2, y2);
    };
    const layers = () => browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] .face-layer')].map((b) => b.textContent)`);
    await tool('Rectangle');
    await drag([5, 20], [25, 40]);
    await browser.waitFor(`document.querySelectorAll('.designer-dialog[open] .face-layer').length === 1`, 'the rectangle');
    expectEqual(await layers(), ['1. rect'], 'the shapes after the rectangle');
    const field = (label) => browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] .designer-fields .inspector-field')].find((r) => r.querySelector('label')?.textContent === ${JSON.stringify(label)})?.querySelector('input')?.value`);
    expectEqual([await field('X'), await field('Width')], ['5', '20'], 'the rectangle as it was drawn');
    await drag([15, 30], [20, 30]);
    await browser.waitFor(`[...document.querySelectorAll('.designer-dialog[open] .designer-fields .inspector-field')].find((r) => r.querySelector('label')?.textContent === 'X')?.querySelector('input').value === '10'`, 'the rectangle to be moved');
    const [hx, hy] = await browser.evaluate(`(() => { const r = document.querySelector('.designer-dialog[open] .face-stage [data-handle="e"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    const [gx, gy] = await at(35, 30);
    await browser.mouse('mouseMoved', hx, hy);
    await browser.mouse('mousePressed', hx, hy);
    await browser.mouse('mouseMoved', gx, gy);
    await browser.mouse('mouseReleased', gx, gy);
    await browser.waitFor(`[...document.querySelectorAll('.designer-dialog[open] .designer-fields .inspector-field')].find((r) => r.querySelector('label')?.textContent === 'Width')?.querySelector('input').value === '25'`, 'the rectangle to be widened');
    const press = (label) => browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] .face-side button, .designer-dialog[open] .inspector-actions button')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
    await press('Turn right');
    await browser.waitFor(`[...document.querySelectorAll('.designer-dialog[open] .designer-fields .inspector-field')].find((r) => r.querySelector('label')?.textContent === 'Width')?.querySelector('input').value === '20'`, 'the rectangle to be turned');
    expectEqual([await field('Width'), await field('Height')], ['20', '25'], 'the sides of the rectangle after a quarter turn');
    await tool('Text');
    const [tx, ty] = await at(26, 60);
    await browser.mouse('mousePressed', tx, ty);
    await browser.mouse('mouseReleased', tx, ty);
    await browser.waitFor(`document.querySelectorAll('.designer-dialog[open] .face-layer').length === 2`, 'the text');
    await browser.evaluate(`(() => {
      const row = [...document.querySelectorAll('.designer-dialog[open] .face-side .inspector-field, .designer-dialog[open] .designer-fields .inspector-field')].find((r) => r.querySelector('label')?.textContent === 'Text');
      const input = row.querySelector('input'); input.value = 'RCD'; input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await browser.waitFor(`[...document.querySelectorAll('.designer-dialog[open] .face-layer')].some((b) => b.textContent.includes('RCD'))`, 'the words of the text');
    await press('Turn left');
    await browser.waitFor(`[...document.querySelectorAll('.designer-dialog[open] .designer-fields .inspector-field')].find((r) => r.querySelector('label')?.textContent === 'Rotation')?.querySelector('input').value === '-90'`, 'the text to be turned');
    await browser.evaluate(`(() => { const i = [...document.querySelectorAll('.designer-dialog[open] .designer-fields .inspector-field')].find((r) => r.querySelector('label')?.textContent === 'Rotation').querySelector('input'); i.value = '90'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await browser.waitFor(`[...document.querySelectorAll('.designer-dialog[open] .designer-fields .inspector-field')].find((r) => r.querySelector('label')?.textContent === 'Rotation')?.querySelector('input').value === '90'`, 'the rotation to be typed');
    await browser.evaluate(`(() => { const i = [...document.querySelectorAll('.designer-dialog[open] .designer-fields .inspector-field')].find((r) => r.querySelector('label')?.textContent === 'Short name').querySelector('input'); i.value = 'FT'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await tool('Polyline');
    for (const p of [[8, 70], [26, 80], [40, 70]]) { const [x, y] = await at(...p); await browser.mouse('mousePressed', x, y); await browser.mouse('mouseReleased', x, y); }
    await browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] .face-stage .designer-toolbar button')].find((b) => b.textContent === 'Finish line').click()`);
    await browser.waitFor(`document.querySelectorAll('.designer-dialog[open] .face-layer').length === 3`, 'the polyline');
    await browser.evaluate(`(() => {
      const row = [...document.querySelectorAll('.designer-dialog[open] .designer-fields .inspector-field')].find((r) => r.querySelector('label')?.textContent === 'On other widths');
      const select = row.querySelector('select'); select.value = 'stretch'; select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await browser.waitFor(`document.querySelector('.designer-dialog[open] .face-layer.selected')?.textContent.includes('stretch')`, 'the anchor to be set');
    const imported = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><script>alert(1)</script><image href="x.png"/><rect x="0" y="0" width="20" height="4" fill="#cc0000"/><circle cx="10" cy="12" r="6" fill="none" stroke="#000000" stroke-width="1"/><path d="M4 18 A6 6 0 0 1 16 18" stroke="#003399" fill="none"/></svg>`;
    await browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] .face-stage .designer-toolbar button')].find((b) => b.textContent === 'Import SVG…').click()`);
    await browser.waitFor(`document.querySelector('.designer-dialog[open] dialog[open] textarea')`, 'the import dialog');
    await browser.evaluate(`(() => { const t = document.querySelector('.designer-dialog[open] dialog[open] textarea'); t.value = ${JSON.stringify(imported)}; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await browser.waitFor(`document.querySelector('.designer-dialog[open] dialog[open] .svg-import-preview svg') && !document.querySelector('.designer-dialog[open] dialog[open] button.primary').disabled`, 'the preview of the SVG');
    expectEqual(await browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] dialog[open] .svg-import-notes li')].map((l) => l.textContent)`), ['<script> is not drawn.', '<image> is not drawn.'], 'what the import leaves out');
    await browser.evaluate(`document.querySelector('.designer-dialog[open] dialog[open] button.primary').click()`);
    await browser.waitFor(`document.querySelectorAll('.designer-dialog[open] .face-layer').length === 6`, 'the imported shapes');
    expectEqual(await layers(), ['1. rect', '2. text “RCD”', '3. polyline stretch', '4. rect', '5. ellipse', '6. path'], 'the shapes after the import');
    await browser.evaluate(`document.querySelector('.designer-dialog[open] button.primary').click()`);
    await browser.waitFor(`document.querySelector('.designer-dialog[open] .editor-status')?.textContent.includes('Saved')`, 'the module to be saved');
    const art = await browser.evaluate(`(async () => {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open('eebox', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const libraries = await new Promise((resolve, reject) => { const r = db.transaction('libraries').objectStore('libraries').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const saved = libraries.flatMap((l) => l.modules).find((m) => m.name === 'Face test');
      return saved && { short: saved.shortName, art: saved.art.map((s) => [s.kind, s.anchor ?? 'left', s.text ?? '', s.rotation ?? 0]) };
    })()`);
    expectEqual(art, { short: 'FT', art: [['rect', 'left', '', 0], ['text', 'left', 'RCD', 90], ['polyline', 'stretch', '', 0], ['rect', 'left', '', 0], ['ellipse', 'left', '', 0], ['path', 'left', '', 0]] }, 'the drawing stored with the module');
    await browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] header button')].find((b) => b.textContent === 'Close').click()`);
    await browser.waitFor(`!document.querySelector('.designer-dialog[open]')`, 'the designer to close');
  });

  await step('a design made of a placed bundled module is on the panel at once, and the next edit goes to the same module', async () => {
    await browser.waitFor(`!document.querySelector('.designer-dialog[open]')`, 'the earlier designer to close');
    const place = await browser.evaluate(`(async () => {
      const search = document.getElementById('palette-search');
      search.value = 'mcb 1p b6'; search.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      const r = document.querySelector('#palette .module').getBoundingClientRect();
      return [r.x + 20, r.y + r.height / 2];
    })()`);
    await browser.mouse('mousePressed', place[0], place[1]);
    await browser.mouse('mouseMoved', place[0] + 60, place[1] + 20);
    await browser.mouse('mouseMoved', 700, 400);
    await browser.mouse('mouseMoved', 640, 395);
    await browser.mouse('mouseReleased', 640, 395);
    await browser.waitFor(`document.getElementById('inspector').innerText.includes('MCB 1P B6')`, 'the placed module in the inspector');
    const designer = async () => {
      await browser.evaluate(`[...document.querySelectorAll('#inspector button')].find((b) => b.textContent === 'Edit module…').click()`);
      await browser.waitFor(`document.querySelector('.designer-dialog[open] .designer-fields')`, 'the designer');
    };
    const field = (label) => browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] .designer-fields .inspector-field')].find((r) => r.querySelector('label')?.textContent === ${JSON.stringify(label)})?.querySelector('input,select')?.value`);
    const drawRect = async (from, to) => {
      const [[x1, y1], [x2, y2]] = await browser.evaluate(`(() => {
        const svg = document.querySelector('.designer-dialog[open] .face-stage svg'); const r = svg.getBoundingClientRect();
        const k = r.width / svg.width.baseVal.value; const scale = (svg.width.baseVal.value - 24) / 17.5;
        const at = (p) => [r.left + (12 + p[0] * scale) * k, r.top + (12 + p[1] * scale) * k];
        return [at(${JSON.stringify(from)}), at(${JSON.stringify(to)})];
      })()`);
      await browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] .face-stage .designer-toolbar button')].find((b) => b.textContent === 'Rectangle').click()`);
      await browser.mouse('mouseMoved', x1, y1);
      await browser.mouse('mousePressed', x1, y1);
      await browser.mouse('mouseMoved', x2, y2);
      await browser.mouse('mouseReleased', x2, y2);
    };
    const savedArt = () => browser.evaluate(`JSON.parse(localStorage.getItem('eebox:autosave')).modules && Object.values(JSON.parse(localStorage.getItem('eebox:autosave')).modules).find((m) => m.name === 'Swap test')?.art?.length`);

    await designer();
    expectEqual(await field('Id'), 'mcb-1p-b6-copy', 'the module the designer works on');
    await browser.evaluate(`(() => { const row = [...document.querySelectorAll('.designer-dialog[open] .designer-fields .inspector-field')].find((r) => r.querySelector('label')?.textContent === 'Name'); const i = row.querySelector('input'); i.value = 'Swap test'; i.dispatchEvent(new Event('change', { bubbles: true })); [...document.querySelectorAll('.designer-dialog[open] .designer-modes button')].find((b) => b.textContent === 'Face').click(); })()`);
    await browser.waitFor(`document.querySelector('.designer-dialog[open] .face-stage svg')`, 'the face');
    await drawRect([2, 30], [12, 40]);
    await browser.waitFor(`document.querySelectorAll('.designer-dialog[open] .face-layer').length === 2`, 'the rectangle');
    const exported = await browser.evaluate(`(async () => {
      let blob = null; let name = ''; const create = URL.createObjectURL; URL.createObjectURL = (b) => { blob = b; return create(b); };
      const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { name = this.download; };
      [...document.querySelectorAll('.designer-dialog[open] .face-stage .designer-toolbar button')].find((b) => b.textContent === 'Export SVG').click();
      await new Promise((r) => setTimeout(r, 400));
      HTMLAnchorElement.prototype.click = click; URL.createObjectURL = create;
      return { name, text: blob ? await blob.text() : '' };
    })()`);
    expectEqual(exported.name, 'swap-test-face.svg', 'the name of the exported file');
    expectTrue(exported.text.startsWith('<svg ') && (exported.text.match(/<rect /g) ?? []).length === 2, 'the exported face has not its two rectangles');
    await browser.evaluate(`document.querySelector('.designer-dialog[open] button.primary').click()`);
    await browser.waitFor(`document.querySelector('.designer-dialog[open] .editor-status')?.textContent.includes('Saved')`, 'the module to be saved');
    await browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] header button')].find((b) => b.textContent === 'Close').click()`);
    await browser.waitFor(`!document.querySelector('.designer-dialog[open]')`, 'the designer to close');
    await browser.waitFor(`document.getElementById('inspector').innerText.includes('Swap test')`, 'the placed module to take the design');
    await browser.waitFor(`document.getElementById('status').textContent.includes('now uses')`, 'the status to say so');
    await browser.waitFor(`localStorage.getItem('eebox:autosave').includes('Swap test')`, 'the autosave to hold the design');
    expectEqual(await savedArt(), 2, 'the shapes of the module the project stored');

    await designer();
    expectEqual([await field('Id'), await field('Name')], ['mcb-1p-b6-copy', 'Swap test'], 'the module the second edit opens');
    await browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] .designer-modes button')].find((b) => b.textContent === 'Face').click()`);
    await browser.waitFor(`document.querySelector('.designer-dialog[open] .face-stage svg')`, 'the face again');
    await drawRect([2, 45], [12, 55]);
    await browser.waitFor(`document.querySelectorAll('.designer-dialog[open] .face-layer').length === 3`, 'the second rectangle');
    await browser.evaluate(`document.querySelector('.designer-dialog[open] button.primary').click()`);
    await browser.waitFor(`document.querySelector('.designer-dialog[open] .editor-status')?.textContent.includes('Saved')`, 'the second save');
    await browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] header button')].find((b) => b.textContent === 'Close').click()`);
    await browser.waitFor(`!document.querySelector('.designer-dialog[open]')`, 'the designer to close');
    await browser.waitFor(`document.getElementById('status').textContent.includes('has the new')`, 'the panel to take the second edit');
    await browser.waitFor(`JSON.parse(localStorage.getItem('eebox:autosave')).modules && Object.values(JSON.parse(localStorage.getItem('eebox:autosave')).modules).find((m) => m.name === 'Swap test')?.art?.length === 3`, 'the project to hold the three shapes');
    const found = (query) => browser.evaluate(`(async () => {
      const search = document.getElementById('palette-search'); search.value = ${JSON.stringify(query)}; search.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      return [...document.querySelectorAll('#palette .module')].map((m) => m.textContent.trim());
    })()`);
    expectEqual((await found('swap test')).length, 1, 'the modules called Swap test in the palette');
    expectEqual((await found('b6 (copy)')).length, 0, 'the copies of the bundled module that the second edit would have made');
    await found('');
  });

  await step('a module of My modules is copied and taken out from the palette', async () => {
    const found = (query) => browser.evaluate(`(async () => {
      const search = document.getElementById('palette-search'); search.value = ${JSON.stringify(query)}; search.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      return [...document.querySelectorAll('#palette .module')].map((m) => m.querySelector('.module-name').firstChild.textContent);
    })()`);
    const press = (name, label) => browser.evaluate(`[...document.querySelectorAll('#palette .module')].find((m) => m.querySelector('.module-name').firstChild.textContent === ${JSON.stringify(name)}).querySelector('.module-action[title^="${label}"]').click()`);
    expectEqual(await found('swap test'), ['Swap test'], 'the module before it is copied');
    await press('Swap test', 'Make a copy');
    await browser.waitFor(`document.getElementById('status').textContent.includes('(copy)')`, 'the copy to be made');
    expectEqual(await found('swap test'), ['Swap test', 'Swap test (copy)'], 'the modules after the copy');
    await press('Swap test (copy)', 'Take this module out');
    await browser.waitFor(`[...document.querySelectorAll('dialog[open] button')].some((b) => b.textContent === 'Take out')`, 'the question');
    await browser.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Take out').click()`);
    await browser.waitFor(`document.getElementById('status').textContent.includes('Took')`, 'the module to be taken out');
    expectEqual(await found('swap test'), ['Swap test'], 'the modules after it is taken out');
    await found('');
  });

  await step('Check lists what is wrong, and a click on an item shows it on the drawing', async () => {
    const project = JSON.parse(example);
    const kitchen = project.project.schematic.nodes.find((n) => n.label === 'Kitchen sockets').id;
    project.project.schematic.wires = project.project.schematic.wires.filter((w) => !((w.a.node === kitchen && w.a.terminal === 'top:PE') || (w.b.node === kitchen && w.b.terminal === 'top:PE')));
    await browser.evaluate(`(async () => {
      const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(JSON.stringify(project))}], 'earth.json'));
      const input = document.getElementById('open-project'); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click();
    })()`);
    await browser.waitFor(`document.getElementById('status').textContent.includes('earth.json loaded')`, 'the project to load');
    await clickButton('Panel');
    await browser.evaluate(`[...document.querySelectorAll('#problems button')].find((b) => b.textContent === 'Close')?.click()`);
    await clickButton('Check');
    await browser.waitFor(`!document.getElementById('problems').hidden`, 'the list of problems');
    expectEqual(await browser.evaluate(`[...document.querySelectorAll('#problems .problem')].map((b) => b.querySelector('.problem-badge').textContent)`), ['Advice'], 'the kinds of what was found');
    expectTrue(await browser.evaluate(`document.querySelector('#problems .problem').textContent.includes('protective earth is not connected')`), 'the words of the advice');
    await browser.evaluate(`document.querySelector('#problems .problem').click()`);
    await browser.waitFor(`document.body.dataset.mode === 'schematic'`, 'the schematic to be shown');
    await browser.waitFor(`document.getElementById('inspector').innerText.includes('Kitchen sockets')`, 'the node to be selected');
    await browser.evaluate(`[...document.querySelectorAll('#problems button')].find((b) => b.textContent === 'Close').click()`);
    expectTrue(await browser.evaluate(`document.getElementById('problems').hidden`), 'the list to close');
    await clickButton('Panel');
  });

  await step('the face editor selects several shapes, aligns them, turns one by an angle, zooms and carries a drawing to another module', async () => {
    await browser.waitFor(`!document.querySelector('.designer-dialog[open]')`, 'the earlier designer to close');
    const open = async () => {
      await browser.evaluate(`document.getElementById('new-module').click()`);
      await browser.waitFor(`[...document.querySelectorAll('.designer-dialog[open] .designer-modes button')].some((b) => b.textContent === 'Face')`, 'the designer');
      await browser.evaluate(`(() => {
        const row = [...document.querySelectorAll('.designer-dialog[open] .designer-fields .inspector-field')].find((r) => r.innerText.startsWith('Width') && !r.innerText.startsWith('Width, mm'));
        const i = row.querySelector('input'); i.value = '3'; i.dispatchEvent(new Event('change', { bubbles: true }));
        [...document.querySelectorAll('.designer-dialog[open] .designer-modes button')].find((b) => b.textContent === 'Face').click();
      })()`);
      await browser.waitFor(`document.querySelector('.designer-dialog[open] .face-stage svg')`, 'the face');
    };
    const key = (code, extra = {}) => browser.evaluate(`document.querySelector('.designer-dialog[open]').dispatchEvent(new KeyboardEvent('keydown', Object.assign({ code: ${JSON.stringify(code)}, key: ${JSON.stringify(code.startsWith('Key') ? code.slice(3).toLowerCase() : code)}, bubbles: true }, ${JSON.stringify(extra)})))`);
    const at = (x, y) => browser.evaluate(`(() => {
      const svg = document.querySelector('.designer-dialog[open] .face-stage svg'); const r = svg.getBoundingClientRect();
      const k = r.width / svg.width.baseVal.value; const scale = (svg.width.baseVal.value - 24) / 52.5;
      return [r.left + (12 + ${x} * scale) * k, r.top + (12 + ${y} * scale) * k];
    })()`);
    const drag = async (from, to) => {
      const [x1, y1] = await at(...from); const [x2, y2] = await at(...to);
      await browser.mouse('mouseMoved', x1, y1); await browser.mouse('mousePressed', x1, y1);
      await browser.mouse('mouseMoved', (x1 + x2) / 2, (y1 + y2) / 2); await browser.mouse('mouseMoved', x2, y2); await browser.mouse('mouseReleased', x2, y2);
    };
    const tool = (name) => browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] .face-stage .designer-toolbar button')].find((b) => b.textContent === ${JSON.stringify(name)}).click()`);
    const press = (label) => browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] .face-side button, .designer-dialog[open] .inspector-actions button')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
    const layers = () => browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] .face-layer')].map((b) => b.textContent)`);
    const selected = () => browser.evaluate(`document.querySelectorAll('.designer-dialog[open] .face-layer.selected').length`);
    const exported = () => browser.evaluate(`(async () => {
      let blob = null; const create = URL.createObjectURL; URL.createObjectURL = (b) => { blob = b; return create(b); };
      const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {};
      [...document.querySelectorAll('.designer-dialog[open] .face-stage .designer-toolbar button')].find((b) => b.textContent === 'Export SVG').click();
      await new Promise((r) => setTimeout(r, 300));
      HTMLAnchorElement.prototype.click = click; URL.createObjectURL = create;
      return blob ? await blob.text() : '';
    })()`);

    await open();
    for (const [from, to] of [[[3, 20], [10, 26]], [[20, 35], [30, 41]], [[38, 50], [46, 58]]]) {
      await tool('Rectangle');
      await drag(from, to);
    }
    await browser.waitFor(`document.querySelectorAll('.designer-dialog[open] .face-layer').length === 3`, 'three rectangles');

    await key('KeyA', { ctrlKey: true });
    await browser.waitFor(`document.querySelectorAll('.designer-dialog[open] .face-layer.selected').length === 3`, 'all the shapes to be selected');
    await press('Left');
    await browser.waitFor(`(() => { const xs = [...document.querySelectorAll('.designer-dialog[open] .face-layer')].length; return xs === 3; })()`, 'the shapes to stay');
    const xs = (await exported()).match(/<rect x="([\d.]+)"/g).map((m) => m.match(/"([\d.]+)"/)[1]);
    expectEqual(new Set(xs).size, 1, 'the x of the three rectangles after Align left');
    await press('Spread down');
    await browser.waitFor(`document.querySelectorAll('.designer-dialog[open] .face-layer').length === 3`, 'the shapes after spreading');

    await key('Escape');
    await browser.waitFor(`document.querySelectorAll('.designer-dialog[open] .face-layer.selected').length === 0`, 'the selection to be cleared');
    await drag([0, 15], [20, 45]);
    await browser.waitFor(`document.querySelectorAll('.designer-dialog[open] .face-layer.selected').length === 2`, 'a rubber band to pick up the two shapes inside');
    await press('Copy');
    await browser.waitFor(`document.getElementById('status').textContent.length >= 0 && [...document.querySelectorAll('.designer-dialog[open] .editor-status')].some((s) => s.textContent.includes('copied'))`, 'the copy to be reported');

    const [wide] = await browser.evaluate(`[document.querySelector('.designer-dialog[open] .face-stage svg').getBoundingClientRect().width]`);
    await tool('Zoom +');
    const [wider] = await browser.evaluate(`[document.querySelector('.designer-dialog[open] .face-stage svg').getBoundingClientRect().width]`);
    expectTrue(wider > wide * 1.2, 'the face to be larger after Zoom +');
    await tool('Fit');

    await browser.evaluate(`document.querySelectorAll('.designer-dialog[open] .face-layer')[0].click()`);
    await browser.evaluate(`(() => { const i = document.querySelector('.designer-dialog[open] .face-angle'); i.value = '30'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await press('Turn by °');
    await browser.waitFor(`[...document.querySelectorAll('.designer-dialog[open] .face-layer')][0].textContent.startsWith('1. path')`, 'the rectangle to become a path when turned by an angle');

    await browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] header button')].find((b) => b.textContent === 'Close').click()`);
    await browser.waitFor(`[...document.querySelectorAll('dialog[open] button')].some((b) => b.textContent === 'Discard')`, 'the question about the unsaved module');
    await browser.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard').click()`);
    await browser.waitFor(`!document.querySelector('.designer-dialog[open]')`, 'the designer to close');

    await open();
    await key('KeyV', { ctrlKey: true });
    await browser.waitFor(`document.querySelectorAll('.designer-dialog[open] .face-layer').length === 2`, 'the two copied shapes to be pasted on another module');
    expectEqual((await layers()).length, 2, 'the shapes of the other module');
    await browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] header button')].find((b) => b.textContent === 'Close').click()`);
    await browser.waitFor(`[...document.querySelectorAll('dialog[open] button')].some((b) => b.textContent === 'Discard')`, 'the question about the second module');
    await browser.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard').click()`);
    await browser.waitFor(`!document.querySelector('.designer-dialog[open]')`, 'the designer to close again');
  });

  await step('the nodes of a schematic are arranged by their distance from the source, then selected together and lined up', async () => {
    await browser.evaluate(`(async () => {
      const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(example)}], 'arrange.json'));
      const input = document.getElementById('open-project'); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click();
    })()`);
    await browser.waitFor(`document.getElementById('status').textContent.includes('arrange.json loaded')`, 'the project to load');
    await clickButton('Schematic');
    const nodes = () => browser.evaluate(`JSON.parse(localStorage.getItem('eebox:autosave')).project.schematic.nodes.map((n) => ({ id: n.id, kind: n.kind, x: n.x, y: n.y }))`);
    const menu = async (id) => {
      await clickButton('Nodes');
      await browser.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
    };
    await menu('arrange-nodes');
    await browser.waitFor(`JSON.parse(localStorage.getItem('eebox:autosave')).project.schematic.nodes.every((n) => n.x % 10 === 0 && n.y % 10 === 0)`, 'the autosave to hold the arranged nodes');
    const arranged = await nodes();
    const source = arranged.find((n) => n.kind === 'source');
    expectTrue(arranged.filter((n) => n.kind === 'load').every((n) => n.y > source.y), 'the loads are not below the source');
    expectTrue(new Set(arranged.map((n) => n.y)).size >= 3, 'the nodes are not in rows');

    await browser.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', ctrlKey: true, bubbles: true }))`);
    await browser.waitFor(`document.getElementById('inspector').innerText.includes('nodes selected')`, 'all the nodes to be selected');
    await menu('align-left');
    await browser.waitFor(`new Set(JSON.parse(localStorage.getItem('eebox:autosave')).project.schematic.nodes.map((n) => n.x)).size === 1`, 'the nodes to be lined up on the left');
    await browser.evaluate(`document.getElementById('undo').click()`);
    await browser.waitFor(`new Set(JSON.parse(localStorage.getItem('eebox:autosave')).project.schematic.nodes.map((n) => n.x)).size > 1`, 'the lining up to be undone');
    await clickButton('Panel');
  });

  await step('the tables of the project open in a dialog, one tab for each, and a click on a heading sorts', async () => {
    await clickButton('Export');
    await browser.evaluate(`document.getElementById('view-tables').click()`);
    await browser.waitFor(`document.querySelector('dialog.tables-dialog[open]')`, 'the tables');
    expectTrue(await browser.evaluate(`document.querySelector('dialog.tables-dialog[open]').getBoundingClientRect().width > 600`), 'the tables dialog is squeezed to the width of a small dialog');
    const tabs = await browser.evaluate(`[...document.querySelectorAll('.tables-tabs button')].map((b) => b.textContent.replace(/ \\(\\d+\\)$/, ''))`);
    expectEqual(tabs, ['Parts', 'Circuits', 'Wires', 'Ferrules'], 'the tabs');
    expectTrue(await browser.evaluate(`document.querySelectorAll('.tables-body tbody tr').length > 3`), 'no parts in the first table');
    await browser.evaluate(`[...document.querySelectorAll('.tables-tabs button')].find((b) => b.textContent.startsWith('Wires')).click()`);
    const firstWire = () => browser.evaluate(`document.querySelector('.tables-body tbody tr td').textContent`);
    const before = await firstWire();
    await browser.evaluate(`document.querySelector('.tables-body th').click()`);
    await browser.evaluate(`document.querySelector('.tables-body th').click()`);
    const after = await firstWire();
    expectTrue(before !== after, 'sorting the wires downwards did not change the first row');
    await browser.evaluate(`document.querySelector('dialog.tables-dialog button.primary').click()`);
    await browser.waitFor(`!document.querySelector('dialog.tables-dialog')`, 'the tables to close');
  });

  await step('a cell of the wires table can be typed over, a wrong value is refused, and Undo takes the edit back', async () => {
    const openWires = async () => {
      await clickButton('Export');
      await browser.evaluate(`document.getElementById('view-tables').click()`);
      await browser.waitFor(`document.querySelector('dialog.tables-dialog[open]')`, 'the tables');
      await browser.evaluate(`[...document.querySelectorAll('.tables-tabs button')].find((b) => b.textContent.startsWith('Wires')).click()`);
    };
    const type = (selector, value, key) =>
      browser.evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true })); })()`);
    const labelInput = `.tables-body input.table-edit[data-shown="0"][data-column="1"]`;
    await openWires();
    expectTrue(await browser.evaluate(`document.querySelectorAll('.tables-body input.table-edit').length > 4`), 'no cell of the wires table is editable');
    await type(labelInput, 'E2E label', 'Enter');
    await browser.waitFor(`document.querySelector(${JSON.stringify(labelInput)})?.value === 'E2E label'`, 'the label to stay in the cell after the edit');
    await browser.evaluate(`document.querySelector('dialog.tables-dialog button.primary').click()`);
    await browser.waitFor(`!document.querySelector('dialog.tables-dialog')`, 'the tables to close');
    await openWires();
    expectEqual(await browser.evaluate(`document.querySelector(${JSON.stringify(labelInput)}).value`), 'E2E label', 'the label after the dialog was opened again');
    await type(`.tables-body input.table-edit[data-shown="0"][data-column="5"]`, 'abc', 'Enter');
    await browser.waitFor(`!document.querySelector('.tables-problem').hidden`, 'the refusal under the table');
    expectTrue((await browser.evaluate(`document.querySelector('.tables-problem').textContent`)).length > 0, 'the refusal has no words');
    await browser.evaluate(`document.querySelector('dialog.tables-dialog button.primary').click()`);
    await browser.waitFor(`!document.querySelector('dialog.tables-dialog')`, 'the tables to close');
    await browser.evaluate(`document.getElementById('undo').click()`);
    await openWires();
    expectEqual(await browser.evaluate(`document.querySelector(${JSON.stringify(labelInput)}).value`), '', 'the label after Undo');
    await browser.evaluate(`document.querySelector('dialog.tables-dialog button.primary').click()`);
    await browser.waitFor(`!document.querySelector('dialog.tables-dialog')`, 'the tables to close');
  });

  await step('the calculation summary lists each circuit with a mark and a reason for every check', async () => {
    await clickButton('Export');
    await browser.evaluate(`document.getElementById('view-checks').click()`);
    await browser.waitFor(`document.querySelector('dialog.tables-dialog[open] .tables-body table')`, 'the summary');
    const headings = await browser.evaluate(`[...document.querySelectorAll('.tables-body th')].map((th) => th.textContent.replace(/[ ▴▾✎]+$/, ''))`);
    expectEqual(headings, ['Load', 'Current, A', 'Cable', 'Voltage drop', 'Breaker', 'RCD', 'Earth', 'Result'], 'the columns of the summary');
    const marked = await browser.evaluate(`document.querySelectorAll('.tables-body td[class*="mark-"]').length`);
    expectTrue(marked >= 6, `only ${marked} cells carry a mark`);
    expectTrue(await browser.evaluate(`[...document.querySelectorAll('.tables-body td[title]')].every((td) => td.title.length > 0)`), 'a cell has an empty reason');
    expectTrue((await browser.evaluate(`document.querySelector('.tables-note')?.textContent ?? ''`)).includes('circuit'), 'no count of the circuits');
    await browser.evaluate(`document.querySelector('dialog.tables-dialog button.primary').click()`);
    await browser.waitFor(`!document.querySelector('dialog.tables-dialog')`, 'the summary to close');
  });

  await step('the library editor opens a module in the designer and takes the changes back unsaved', async () => {
    await browser.evaluate(`[...document.querySelectorAll('#palette button')].find((b) => b.textContent === 'edit').click()`);
    await browser.waitFor(`document.querySelector('.editor-dialog[open]')`, 'the library editor');
    await browser.evaluate(`[...document.querySelectorAll('.editor-dialog[open] .editor-item')].find((i) => i.textContent.includes('Smoke test module')).click()`);
    await browser.waitFor(`[...document.querySelectorAll('.editor-dialog[open] .editor-fields button')].some((b) => b.textContent === 'Open in designer')`, 'the designer button');
    await browser.evaluate(`[...document.querySelectorAll('.editor-dialog[open] .editor-fields button')].find((b) => b.textContent === 'Open in designer').click()`);
    await browser.waitFor(`document.querySelector('.designer-dialog[open] .designer-fields')`, 'the designer');
    await browser.evaluate(`(() => {
      const row = [...document.querySelectorAll('.designer-dialog[open] .designer-fields .inspector-field')].find((r) => r.innerText.startsWith('Name'));
      const input = row.querySelector('input'); input.value = 'Renamed in designer'; input.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('.designer-dialog[open] button.primary').click();
    })()`);
    await browser.waitFor(`document.querySelector('.designer-dialog[open] .editor-status')?.textContent.includes('Saved')`, 'the designer to save');
    await browser.evaluate(`[...document.querySelectorAll('.designer-dialog[open] header button')].find((b) => b.textContent === 'Close').click()`);
    await browser.waitFor(`!document.querySelector('.designer-dialog[open]')`, 'the designer to close');
    await browser.waitFor(`[...document.querySelectorAll('.editor-dialog[open] .editor-item')].some((i) => i.textContent.includes('Renamed in designer'))`, 'the editor to show the new name');
    expectTrue(await browser.evaluate(`!document.querySelector('.editor-dialog[open] header button.primary').disabled`), 'the editor to offer to save');
    await browser.evaluate(`[...document.querySelectorAll('.editor-dialog[open] header button')].find((b) => b.textContent === 'Close').click()`);
    await browser.waitFor(`[...document.querySelectorAll('dialog[open] button')].some((b) => b.textContent === 'Discard')`, 'the question about the unsaved changes');
    await browser.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard').click()`);
    await browser.waitFor(`!document.querySelector('.editor-dialog[open]')`, 'the editor to close');
  });

  await step('an example is chosen from the File menu and loads without problems', async () => {
    await clickButton('File');
    await browser.evaluate(`document.getElementById('open-example').click()`);
    await browser.waitFor(`document.querySelector('.examples-dialog[open]')`, 'the examples dialog');
    expectEqual(await browser.evaluate(`[...document.querySelectorAll('.example-item strong')].map((s) => s.textContent)`), ['Studio flat', 'House panel', 'Workshop with a backup input', 'Automatic backup with a transfer controller', 'TN-C-S entry with a PEN conductor'], 'examples listed');
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
    expectEqual(await browser.evaluate(`document.querySelectorAll('dialog[open] .colours-table tbody tr').length`), 10, 'one row for each conductor');
    await browser.evaluate(`(() => { const s = document.querySelector('dialog[open] select'); s.value = 'pue'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await browser.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Save').click()`);
    await browser.waitFor(`JSON.parse(localStorage.getItem('eebox:colour-scheme') ?? '{}').scheme === 'pue'`, 'the chosen scheme to be stored');
    await clickButton('Schematic');
    const svg = await browser.evaluate(`(async () => {
      let blob = null; const create = URL.createObjectURL; URL.createObjectURL = (b) => { blob = b; return create(b); };
      const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {};
      document.getElementById('export-svg').click(); await new Promise((r) => setTimeout(r, 400));
      HTMLAnchorElement.prototype.click = click; URL.createObjectURL = create; return await blob.text();
    })()`);
    expectTrue(svg.includes('#ffd700') && svg.includes('#ff0000'), 'the exported drawing does not use the PUE colours');
    expectTrue(svg.includes('data:font/woff;base64,'), 'the exported drawing does not carry its font');
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
