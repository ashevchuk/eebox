/**
 * The marks of Check on the drawing and the colour of its button, in a real browser: the red and amber frames around
 * modules are drawn only while the list of Check is open (and the one picked in it stays after it is closed), and the
 * button shows the worst thing found, how many there are, and pulses when something new is found.
 * Run `npm run build:dist-file` first.
 */
import { readFileSync } from 'node:fs';
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

/** The studio flat with wires added to its main switch (p1, node n1): what is added decides what Check finds. */
function project(extraWires) {
  const file = JSON.parse(readFileSync('examples/studio-flat.json', 'utf8'));
  file.project.schematic.wires.push(...extraWires.map(([a, b], i) => ({ id: `w9${i}`, a: { node: a[0], terminal: a[1] }, b: { node: b[0], terminal: b[1] } })));
  return JSON.stringify(file);
}
const BYPASS = [[['n6', 'bottom:L'], ['n1', 'bottom:L']]];
const SHORT = [[['n1', 'bottom:L'], ['n1', 'bottom:N']]];

async function open(text) {
  await browser.goto(page);
  await browser.evaluate(`localStorage.setItem('eebox:tour-done', 'yes'); localStorage.setItem('eebox:autosave', ${JSON.stringify(text)});`);
  await browser.goto(page);
  await browser.resize(1516, 784);
  await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the palette');
  await wait(600);
}
const button = () => browser.evaluate(`(() => { const b = document.getElementById('check'); return { classes: [...b.classList].sort().join(' '), count: b.dataset.count ?? '', colour: getComputedStyle(b).color }; })()`);
/** How many pixels of the canvas are close to the amber or the red of a frame around a module; the frame is thin and smoothed, so only the differences between two looks mean something. */
const frames = () =>
  browser.evaluate(`(() => {
    const c = document.getElementById('stage');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const near = (i, r, g, b) => Math.abs(d[i] - r) < 40 && Math.abs(d[i + 1] - g) < 40 && Math.abs(d[i + 2] - b) < 40;
    let amber = 0, red = 0;
    for (let i = 0; i < d.length; i += 4) { if (near(i, 245, 158, 11)) amber++; else if (near(i, 239, 68, 68)) red++; }
    return { amber, red };
  })()`);
const toggleCheck = async () => {
  await browser.evaluate(`document.getElementById('check').click()`);
  await wait(400);
};

try {
  browser = await launch();

  await open(project(BYPASS));
  let closed;
  await step('with advice only the button is amber and counts it', async () => {
    const b = await button();
    expectTrue(b.classes.includes('check-advice') && !b.classes.includes('check-error'), `classes: ${b.classes}`);
    expectTrue(Number(b.count) >= 1, `count: ${b.count}`);
    expectTrue(b.colour === 'rgb(245, 197, 24)', `colour: ${b.colour}`);
    closed = await frames();
  });

  let opened;
  await step('opening Check draws the amber frame, and closing it takes the frame away', async () => {
    await toggleCheck();
    expectTrue((await button()).classes.includes('active'), 'the button does not show that Check is open');
    opened = await frames();
    expectTrue(opened.amber > closed.amber + 40, `amber pixels: ${closed.amber} closed, ${opened.amber} open`);
    await toggleCheck();
    const again = await frames();
    expectTrue(again.amber === closed.amber, `amber pixels after closing: ${again.amber}, before opening: ${closed.amber}`);
  });

  await step('the finding picked in the list keeps its frame after the list is closed, and Escape takes it away', async () => {
    await toggleCheck();
    const picked = await browser.evaluate(`(() => { const row = [...document.querySelectorAll('#problems .problem.advice')].find((r) => /both of its sides/.test(r.textContent)); if (!row) return false; row.click(); return true; })()`);
    expectTrue(picked, 'no row about a device fed from both sides in the list');
    await wait(400);
    await browser.evaluate(`[...document.querySelectorAll('#problems .problems-header button')].find((b) => b.textContent === 'Close').click()`);
    await wait(400);
    const kept = await frames();
    expectTrue(kept.amber > closed.amber + 15, `amber pixels with the finding picked: ${kept.amber}, none expected: ${closed.amber}`);
    expectTrue(!(await button()).classes.includes('active'), 'the button still shows Check as open');
    await browser.key('Escape', 'Escape', 27);
    await wait(400);
    const gone = await frames();
    expectTrue(gone.amber < kept.amber, `amber pixels after Escape: ${gone.amber}, with the finding picked: ${kept.amber}`);
  });

  await open(project(BYPASS.concat(SHORT)));
  let redClosed = 0;
  await step('a fault turns the button red, and it wins over advice', async () => {
    const b = await button();
    expectTrue(b.classes.includes('check-error') && !b.classes.includes('check-advice'), `classes: ${b.classes}`);
    expectTrue(b.colour === 'rgb(248, 113, 113)', `colour: ${b.colour}`);
    expectTrue(Number(b.count) >= 2, `count: ${b.count}`);
    redClosed = (await frames()).red;
  });
  await step('a fault is framed in red once Check is open', async () => {
    await toggleCheck();
    const redOpen = (await frames()).red;
    expectTrue(redOpen > redClosed + 40, `red pixels: ${redClosed} closed, ${redOpen} open`);
    await toggleCheck();
    expectTrue((await frames()).red === redClosed, 'the red frame stays after Check is closed');
  });

  await open(JSON.stringify(JSON.parse(readFileSync('examples/studio-flat.json', 'utf8'))));
  await step('a clean project leaves the button plain, with no count and no pulse', async () => {
    const b = await button();
    expectTrue(!/check-(advice|error)|pulse/.test(b.classes) && b.count === '', `button: ${JSON.stringify(b)}`);
  });
  await step('opening a project with findings pulses the button, and the pulse ends by itself', async () => {
    await browser.evaluate(`(() => { const input = document.getElementById('open-project'); const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(project(BYPASS))}], 'found.eebox.json', { type: 'application/json' })); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await browser.waitFor(`document.querySelector('dialog[open] button.primary')`, 'the question whether to discard the current panel');
    await browser.evaluate(`document.querySelector('dialog[open] button.primary').click()`);
    await browser.waitFor(`document.getElementById('check').classList.contains('pulse')`, 'the button to pulse');
    await browser.waitFor(`!document.getElementById('check').classList.contains('pulse')`, 'the pulse to end', 8000);
  });

  await step('the page raised no errors', async () => {
    const problems = browser.problems;
    expectTrue(problems.length === 0, problems.join('; '));
  });
} finally {
  await browser?.close();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
console.log('\ncheck marks test passed');
