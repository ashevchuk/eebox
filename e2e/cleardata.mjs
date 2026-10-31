/**
 * "Clear all data" in the projects dialog, in a real browser: it asks twice, a cancel at either question deletes
 * nothing, and the second yes empties localStorage (our keys only) and both IndexedDB databases and reloads the page.
 * Run `npm run build:dist-file` first.
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

const press = (label) =>
  browser.evaluate(`(() => { const b = [...document.querySelectorAll('dialog[open] button')].find((x) => x.textContent === ${JSON.stringify(label)}); if (b) b.click(); return !!b; })()`);

const databases = () => browser.evaluate(`indexedDB.databases().then((all) => all.map((d) => d.name).sort())`);
const ours = () => browser.evaluate(`Object.keys(localStorage).filter((k) => k.startsWith('eebox:')).sort()`);

async function openProjects() {
  await browser.evaluate(`document.getElementById('menu-file').click()`);
  await browser.evaluate(`document.getElementById('open-projects').click()`);
  await browser.waitFor(`!!document.querySelector('dialog[open].projects-dialog')`, 'the projects dialog');
}

try {
  browser = await launch();
  await browser.goto(page);
  await browser.evaluate(`localStorage.setItem('eebox:tour-done', 'yes')`);
  await browser.goto(page);
  await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the palette');
  await browser.evaluate(`localStorage.setItem('other-app:keep', 'me')`);

  await step('the button is red and sits in the projects dialog', async () => {
    await openProjects();
    const colour = await browser.evaluate(`getComputedStyle([...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Clear all data…')).backgroundColor`);
    expectTrue(colour === 'rgb(185, 28, 28)', `button colour was ${colour}`);
  });

  await step('cancelling the first question deletes nothing', async () => {
    await press('Clear all data…');
    await browser.waitFor(`!!document.querySelector('dialog[open] button')`, 'the first question');
    await press('Cancel');
    await wait(300);
    expectTrue((await ours()).includes('eebox:tour-done'), 'a key was deleted');
    expectTrue((await databases()).includes('eebox-projects'), 'a database was deleted');
  });

  await step('cancelling the second question deletes nothing', async () => {
    await openProjects();
    await press('Clear all data…');
    await browser.waitFor(`[...document.querySelectorAll('dialog[open] button')].some((b) => b.textContent === 'Continue')`, 'the first question');
    await press('Continue');
    await browser.waitFor(`[...document.querySelectorAll('dialog[open] button')].some((b) => b.textContent === 'Delete everything')`, 'the second question');
    await press('Cancel');
    await wait(300);
    expectTrue((await ours()).includes('eebox:tour-done'), 'a key was deleted');
    expectTrue((await databases()).includes('eebox-projects'), 'a database was deleted');
  });

  await step('two yes answers empty our storage, keep the other keys, and reload the page', async () => {
    await browser.evaluate(`localStorage.setItem('eebox:grid', '25')`);
    await openProjects();
    await press('Save the project');
    await browser.waitFor(`document.querySelectorAll('dialog[open] .projects-row').length === 1`, 'the project to be stored');
    await press('Close');
    await browser.evaluate(`window.__stillThisPage = true`);
    await openProjects();
    await press('Clear all data…');
    await browser.waitFor(`[...document.querySelectorAll('dialog[open] button')].some((b) => b.textContent === 'Continue')`, 'the first question');
    await press('Continue');
    await browser.waitFor(`[...document.querySelectorAll('dialog[open] button')].some((b) => b.textContent === 'Delete everything')`, 'the second question');
    await press('Delete everything');
    await browser.waitFor(`window.__stillThisPage !== true`, 'the page to reload');
    await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the palette after the reload');
    await wait(1500);
    expectTrue((await browser.evaluate(`localStorage.getItem('eebox:grid')`)) === null, 'a setting survived');
    await openProjects();
    const rows = await browser.evaluate(`document.querySelectorAll('dialog[open] .projects-row').length`);
    expectTrue(rows === 0, `stored projects left: ${rows}`);
    await press('Close');
    expectTrue((await browser.evaluate(`localStorage.getItem('other-app:keep')`)) === 'me', 'a key of another application was deleted');
  });

  expectTrue(browser.problems.length === 0, `the page raised errors: ${JSON.stringify(browser.problems)}`);
} finally {
  await browser?.close();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} step(s) failed`);
  process.exit(1);
}
console.log('clear data test passed');
