/**
 * The legend of the panel, in a real browser: the dialog prints the chosen columns, the devices of
 * the house example under the numbers and colours of their strips, and the choice is kept with the
 * project. Run `npm run build:dist-file` first.
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
const openDialog = async () => {
  await browser.evaluate(`window.print = () => {}; document.getElementById('print-legend').click()`);
  await browser.waitFor(`document.querySelector('dialog.print-dialog')`, 'the legend dialog');
};
const ticked = () => browser.evaluate(`[...document.querySelectorAll('dialog.print-dialog label')].filter((l) => l.querySelector('input[type=checkbox]')?.checked).map((l) => l.textContent.trim())`);
const pressPrint = async () => {
  await browser.evaluate(`[...document.querySelectorAll('dialog.print-dialog button')].find((b) => b.textContent === 'Print').click()`);
  await browser.waitFor(`document.querySelector('#print-sheet .legend-table')`, 'the legend on the sheet');
};
const table = () => browser.evaluate(`[...document.querySelectorAll('#print-sheet .legend-table tr')].map((r) => [...r.cells].map((c) => c.textContent))`);

try {
  browser = await launch();
  await browser.goto(page);
  await browser.evaluate(`localStorage.setItem('eebox:tour-done', 'yes')`);
  await browser.goto(page);
  await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the palette');
  await browser.evaluate(`(async () => {
    const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(example)}], 'house-panel.json'));
    const input = document.getElementById('open-project'); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    [...document.querySelectorAll('dialog[open] button')].find((b) => b.classList.contains('primary'))?.click();
  })()`);
  await browser.waitFor(`document.getElementById('status').textContent.includes('loaded')`, 'the project to load');

  await step('the legend prints number, description, rating and cross-section of the devices only', async () => {
    await openDialog();
    expectTrue((await ticked()).join() === 'Number,Description,Rating,Cross-section', `ticked: ${(await ticked()).join()}`);
    await pressPrint();
    const rows = await table();
    expectTrue(rows[0].join() === 'No.,Description,A,mm²', `heading ${rows[0].join()}`);
    expectTrue(rows.length === 10, `${rows.length - 1} rows, expected the 9 devices without the bars`);
    expectTrue(rows[3].join() === '5,Oven,C32,6', `the oven row is ${rows[3].join()}`);
  });

  await step('a number is printed in the colour of the header of its strip', async () => {
    const colours = await browser.evaluate(`[...document.querySelectorAll('#print-sheet td.legend-number')].map((c) => getComputedStyle(c).backgroundColor)`);
    expectTrue(colours[0] === 'rgb(208, 208, 208)' && colours.slice(1).every((c) => c === 'rgb(142, 68, 173)'), colours.join(' '));
    await browser.evaluate(`window.dispatchEvent(new Event('afterprint'))`);
  });

  await step('the columns chosen are printed, with the icons, and kept for the next time', async () => {
    await openDialog();
    await browser.evaluate(`[...document.querySelectorAll('dialog.print-dialog label')].filter((l) => /Designation|Icon/.test(l.textContent)).forEach((l) => { const c = l.querySelector('input'); c.checked = true; c.dispatchEvent(new Event('change')); })`);
    await pressPrint();
    expectTrue((await table())[0].join() === 'No.,Designation,Icon,Description,A,mm²', `heading ${(await table())[0].join()}`);
    await browser.media('print');
    const layout = await browser.evaluate(`(() => {
      const cells = [...document.querySelectorAll('#print-sheet .legend-table th, #print-sheet .legend-table td')];
      return {
        displays: [...new Set(cells.map((c) => getComputedStyle(c).display))],
        spilling: cells.filter((c) => c.scrollWidth > c.clientWidth + 1).map((c) => c.textContent),
        icons: [...document.querySelectorAll('#print-sheet .legend-table svg')].map((i) => { const r = i.getBoundingClientRect(); const c = i.closest('td').getBoundingClientRect(); return r.width > 10 && r.height > 10 && r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom; }),
      };
    })()`);
    await browser.media('');
    expectTrue(layout.displays.join() === 'table-cell', `the cells are laid out as ${layout.displays.join()}`);
    expectTrue(layout.spilling.length === 0, `text spills out of its cell: ${layout.spilling.join(' | ')}`);
    expectTrue(layout.icons.length === 3 && layout.icons.every(Boolean), `the three load icons are not drawn inside their cells: ${JSON.stringify(layout.icons)}`);
    await browser.evaluate(`window.dispatchEvent(new Event('afterprint'))`);
    await openDialog();
    expectTrue((await ticked()).join() === 'Number,Designation,Icon,Description,Rating,Cross-section', `kept: ${(await ticked()).join()}`);
    await browser.evaluate(`[...document.querySelectorAll('dialog.print-dialog button')].find((b) => b.textContent === 'Cancel').click()`);
  });

  await step('the page raised no errors', async () => {
    expectTrue(browser.problems.length === 0, browser.problems.join('; '));
  });
} finally {
  await browser?.close();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} step(s) failed`);
  process.exit(1);
}
console.log('all steps passed');
