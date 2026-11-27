/**
 * Printed sheets in a real browser, with the longest labels a project can hold: nothing reaches past
 * the right edge of the page, no cable marker cuts its text off and a heading stays with its table.
 * Ordinary words stay whole; with the largest letters only the description and group of the legend
 * may break them, because all the columns do not fit the page otherwise.
 * Run `npm run build:dist-file` first.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from './browser.mjs';

const page = pathToFileURL(resolve('dist-file/index.html')).href;
const example = JSON.parse(readFileSync(resolve('examples/house-panel.json'), 'utf8'));
const longest = (text) => `${text} ${'with a long description '.repeat(4)}`.slice(0, 60).trim();
const { panel, schematic } = example.project;
panel.title = longest('Panel');
panel.info = { revision: 'B', author: 'A'.repeat(40), date: '2026-01-01', status: 'draft', approver: 'Approver '.repeat(4).trim() };
panel.placements.forEach((p, i) => {
  p.label = i % 2 ? longest(`Circuit ${i}`) : `Supercalifragilisticexpialidocious${i}`;
  p.marking = { group: longest('Group') };
});
for (const node of schematic.nodes) if (node.kind === 'load') node.label = longest(node.label);

/** The printable width of a portrait A4 page with 10 mm margins, in CSS pixels. */
const PORTRAIT_A4_PX = Math.floor((190 * 96) / 25.4);
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

/** Prints from the menu item `button`, after `choose` has set up its dialog, and runs `measure` on the sheet as paper shows it. */
async function printed(button, choose, measure) {
  await browser.resize(1516, 784);
  await browser.evaluate(`window.print = () => {}; document.getElementById('${button}').click()`);
  await wait(200);
  if (choose) await browser.evaluate(`(() => { const d = document.querySelector('dialog.print-dialog'); (${choose})(d); d.querySelector('button.primary').click(); })()`);
  await wait(300);
  await browser.resize(PORTRAIT_A4_PX, 900);
  await browser.media('print');
  await wait(150);
  const result = await browser.evaluate(`(${measure})(document.getElementById('print-sheet'))`);
  await browser.media('');
  await browser.evaluate(`window.dispatchEvent(new Event('afterprint'))`);
  return result;
}
const pastTheEdge = `(sheet) => [...sheet.querySelectorAll('table, h1, h2')].filter((e) => e.getBoundingClientRect().right > sheet.getBoundingClientRect().right + 1).map((e) => e.textContent.slice(0, 40))`;
/** Words of up to this many characters have to stay on one line; only longer ones may be broken to fit. */
const ORDINARY_WORD = 20;
const brokenWords = (cells) => `(sheet) => [...sheet.querySelectorAll('${cells}')].flatMap((cell) => {
  const text = cell.firstChild;
  if (!text || text.nodeType !== Node.TEXT_NODE) return [];
  return [...text.data.matchAll(/\\S+/g)].filter((word) => {
    if (word[0].length > ${ORDINARY_WORD} || /[-\u2013\/]/.test(word[0])) return false;
    const range = document.createRange(); range.setStart(text, word.index); range.setEnd(text, word.index + word[0].length);
    return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1;
  }).map((word) => word[0]);
})`;
const setUp = (fontMm) => `(d) => {
  d.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = true; c.dispatchEvent(new Event('change')); });
  const [paper, orientation] = d.querySelectorAll('.print-page select');
  paper.value = 'A4'; paper.dispatchEvent(new Event('change'));
  orientation.value = 'portrait'; orientation.dispatchEvent(new Event('change'));
  const size = d.querySelector('input[type=number]');
  if (size) { size.value = '${fontMm}'; size.dispatchEvent(new Event('change')); }
}`;

try {
  browser = await launch();
  await browser.goto(page);
  await browser.evaluate(`localStorage.setItem('eebox:tour-done', 'yes'); localStorage.setItem('eebox:language', 'uk')`);
  await browser.goto(page);
  await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the palette');
  await browser.evaluate(`(async () => {
    const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(JSON.stringify(example))}], 'long.json'));
    const input = document.getElementById('open-project'); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    document.querySelector('dialog[open] button.primary')?.click();
  })()`);
  await browser.waitFor(`document.getElementById('status').textContent.includes('\\u0437\\u0430\\u0432\\u0430\\u043d\\u0442\\u0430\\u0436\\u0435\\u043d\\u043e')`, 'the project to load');

  await step('the legend with every column and the largest letters fits a portrait page, its headings whole', async () => {
    const result = await printed('print-legend', setUp(10), `(sheet) => ({ past: (${pastTheEdge})(sheet), broken: (${brokenWords('th')})(sheet) })`);
    expectTrue(result.past.length === 0, `past the right edge: ${result.past.join(' | ')}`);
    expectTrue(result.broken.length === 0, `words broken in two: ${result.broken.slice(0, 12).join(', ')}`);
  });

  await step('the legend with every column and letters of 5 mm breaks no ordinary word', async () => {
    const result = await printed('print-legend', setUp(5), `(sheet) => ({ past: (${pastTheEdge})(sheet), broken: (${brokenWords('th, td')})(sheet) })`);
    expectTrue(result.past.length === 0, `past the right edge: ${result.past.join(' | ')}`);
    expectTrue(result.broken.length === 0, `words broken in two: ${result.broken.slice(0, 12).join(', ')}`);
  });

  await step('the headings of the legend are repeated on every page', async () => {
    const inHead = await printed('print-legend', setUp(10), `(sheet) => sheet.querySelectorAll('.legend-table > thead th').length`);
    expectTrue(inHead === 7, `${inHead} of 7 headings are in the head of the table`);
  });

  await step('the tables of the print sheet fit a portrait page and every heading is kept with what follows', async () => {
    const result = await printed('print', setUp(5), `(sheet) => ({ past: (${pastTheEdge})(sheet), broken: (${brokenWords('th, td')})(sheet), loose: [...sheet.querySelectorAll('h2')].filter((h) => getComputedStyle(h).breakAfter !== 'avoid').map((h) => h.textContent) })`);
    expectTrue(result.past.length === 0, `past the right edge: ${result.past.join(' | ')}`);
    expectTrue(result.broken.length === 0, `words broken in two: ${result.broken.slice(0, 12).join(', ')}`);
    expectTrue(result.loose.length === 0, `headings that may end a page: ${result.loose.join(', ')}`);
  });

  await step('a cable marker shows all of its text', async () => {
    const cut = await printed('print-labels', null, `(sheet) => [...sheet.querySelectorAll('.marker')].filter((m) => m.scrollHeight > m.clientHeight + 1 || m.scrollWidth > m.clientWidth + 1).map((m) => m.textContent)`);
    expectTrue(cut.length === 0, `${cut.length} markers cut off, such as ${cut[0]}`);
  });

  await step('the print sheet is set in the bundled font, so its tables are as wide on every machine', async () => {
    const family = await printed('print', setUp(5), `(sheet) => getComputedStyle(sheet.querySelector('td')).fontFamily`);
    expectTrue(family.replaceAll('"', '').startsWith('eebox-sans'), `the cells are set in ${family}`);
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
