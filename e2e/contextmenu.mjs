/**
 * The context menu, in a real browser: a right click selects what is under it and offers what can be done to
 * it, on the panel and on the schematic; the menu closes on Escape and on a click outside, is reached from the
 * keyboard, and its commands do what the buttons do. The points are those of the bundled automation example
 * after Fit in a 1516 by 784 window. Run `npm run build:dist-file` first.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from './browser.mjs';

const page = pathToFileURL(resolve('dist-file/index.html')).href;
const example = readFileSync(resolve('examples/automation-panel.json'), 'utf8');
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

const MAIN_SWITCH = [525, 200];
const SOFT_STARTER_1 = [555, 410];
const EMPTY = [350, 500];
const menuItems = () => browser.evaluate(`[...document.querySelectorAll('.context-menu .context-item')].map((b) => b.querySelector('span').textContent + (b.disabled ? ' (disabled)' : ''))`);
const menuOpen = () => browser.evaluate(`document.querySelector('.context-menu') !== null`);
const choose = (label) => browser.evaluate(`(() => { const b = [...document.querySelectorAll('.context-menu .context-item')].find((x) => x.querySelector('span').textContent === ${JSON.stringify(label)}); if (!b) throw new Error('no item ' + ${JSON.stringify(label)}); b.click(); })()`);
const shelf = () => browser.evaluate(`document.getElementById('shelf').innerText.match(/\\((\\d+)\\)/)?.[1]`);
const inspectorText = () => browser.evaluate(`document.getElementById('inspector').innerText`);

try {
  browser = await launch();
  await browser.goto(page);
  await browser.evaluate(`localStorage.setItem('eebox:tour-done', 'yes')`);
  await browser.goto(page);
  await browser.resize(1516, 784);
  await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the palette');
  await browser.evaluate(`(async () => {
    const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(example)}], 'automation-panel.json'));
    const input = document.getElementById('open-project'); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click();
  })()`);
  await browser.waitFor(`document.getElementById('status').textContent.includes('loaded')`, 'the project to load');
  await browser.evaluate(`document.getElementById('fit').click()`);
  await wait(500);

  await step('a right click on a module on a rail selects it and offers to take it off, copy, duplicate, delete and undo', async () => {
    await browser.rightClick(...MAIN_SWITCH);
    await browser.waitFor(`document.querySelector('.context-menu')`, 'the menu');
    const items = await menuItems();
    for (const wanted of ['Take off the rail', 'Copy', 'Duplicate', 'Delete', 'Undo (disabled)']) expectTrue(items.includes(wanted), `no "${wanted}" in ${items.join(', ')}`);
    expectTrue(/Module/.test(await inspectorText()), 'the module under the pointer was not selected');
  });

  await step('Escape closes the menu and the module stays selected', async () => {
    await browser.key('Escape', 'Escape', 27);
    expectTrue(!(await menuOpen()), 'the menu is still open');
    expectTrue(/Main switch/.test(await inspectorText()), 'the selection was let go');
  });

  await step('Take off the rail puts the module on the shelf, and Undo from the menu of empty space puts it back', async () => {
    await browser.rightClick(...MAIN_SWITCH);
    await browser.waitFor(`document.querySelector('.context-menu')`, 'the menu');
    await choose('Take off the rail');
    expectTrue(!(await menuOpen()), 'the menu stayed open after a choice');
    await wait(300);
    expectTrue((await shelf()) === '1', `the shelf holds ${await shelf()}`);
    await browser.rightClick(...EMPTY);
    await browser.waitFor(`document.querySelector('.context-menu')`, 'the menu of empty space');
    const items = await menuItems();
    expectTrue(items.includes('Paste (disabled)') && items.includes('Fit to the window') && items.includes('Undo'), items.join(', '));
    await choose('Undo');
    await wait(300);
    expectTrue((await shelf()) === '0', `after Undo the shelf holds ${await shelf()}`);
  });

  await step('a right click on one of several chosen devices keeps the whole group and offers alignment', async () => {
    await browser.mouse('mousePressed', 495, 306, 8);
    await browser.mouse('mouseMoved', 700, 400, 8);
    await browser.mouse('mouseMoved', 950, 525, 8);
    await browser.mouse('mouseReleased', 950, 525, 8);
    await wait(300);
    await browser.rightClick(...SOFT_STARTER_1);
    await browser.waitFor(`document.querySelector('.context-menu')`, 'the menu');
    const items = await menuItems();
    expectTrue(items.includes('Align left edges') && items.includes('Copy'), items.join(', '));
    expectTrue(/items selected/.test(await inspectorText()), 'the group was cut down to one');
    await browser.key('Escape', 'Escape', 27);
  });

  await step('a click outside closes the menu', async () => {
    await browser.rightClick(...EMPTY);
    await browser.waitFor(`document.querySelector('.context-menu')`, 'the menu');
    await browser.mouse('mousePressed', ...EMPTY);
    await browser.mouse('mouseReleased', ...EMPTY);
    await wait(200);
    expectTrue(!(await menuOpen()), 'the menu stayed open');
  });

  await step('the menu key opens the menu for the selection, arrows and Enter choose, and Escape does not let go of the selection', async () => {
    await browser.mouse('mousePressed', ...MAIN_SWITCH);
    await browser.mouse('mouseReleased', ...MAIN_SWITCH);
    await wait(200);
    await browser.key('ContextMenu', 'ContextMenu', 93);
    await browser.waitFor(`document.querySelector('.context-menu')`, 'the menu from the keyboard');
    const focused = () => browser.evaluate(`document.activeElement.querySelector?.('span')?.textContent`);
    const labels = (await menuItems()).filter((l) => !l.endsWith('(disabled)'));
    expectTrue((await focused()) === labels[0], `the first item has no focus: ${await focused()}`);
    await browser.key('ArrowDown', 'ArrowDown', 40);
    expectTrue((await focused()) === labels[1], `ArrowDown did not move to the next item: ${await focused()}`);
    await browser.key('Escape', 'Escape', 27);
    expectTrue(!(await menuOpen()) && /Main switch/.test(await inspectorText()), 'Escape closed the menu but also let go of the selection');
    await browser.key('ContextMenu', 'ContextMenu', 93);
    await browser.waitFor(`document.querySelector('.context-menu')`, 'the menu again');
    const at = labels.indexOf('Take off the rail');
    for (let n = 0; n < at; n++) await browser.key('ArrowDown', 'ArrowDown', 40);
    await browser.key('Enter', 'Enter', 13, '\r');
    await wait(300);
    expectTrue((await shelf()) === '1', `Enter on Take off the rail did not take the module off: shelf ${await shelf()}`);
    await browser.evaluate(`document.getElementById('undo').click()`);
    await wait(200);
  });

  await step('on the schematic a node offers Delete, and empty space offers the commands of the Nodes menu', async () => {
    await browser.evaluate(`document.getElementById('mode-schematic').click()`);
    await wait(600);
    await browser.rightClick(450, 214);
    await browser.waitFor(`document.querySelector('.context-menu')`, 'the node menu');
    expectTrue((await menuItems()).includes('Delete'), (await menuItems()).join(', '));
    await browser.key('Escape', 'Escape', 27);
    await browser.rightClick(900, 200);
    await browser.waitFor(`document.querySelector('.context-menu')`, 'the menu of empty space');
    const items = await menuItems();
    for (const wanted of ['Select all', 'Sync modules', 'Number the wires…']) expectTrue(items.includes(wanted), `no "${wanted}" in ${items.join(', ')}`);
    await choose('Number the wires…');
    await browser.waitFor(`document.querySelector('dialog[open] input')`, 'the numbering dialog');
    await browser.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Cancel').click()`);
  });

  expectTrue(browser.problems.length === 0, `the page raised errors: ${JSON.stringify(browser.problems)}`);
} finally {
  await browser?.close();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} step(s) failed`);
  process.exit(1);
}
console.log('\ncontext menu test passed');
