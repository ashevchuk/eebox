/**
 * The toolbar in windows of different widths, in a real browser: it stays on one row down to a phone held across,
 * the buttons that do not fit are in the More menu and work from there, and they come back when the window is
 * wide again. Run `npm run build:dist-file` first.
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
const state = () =>
  browser.evaluate(`(() => {
    const h = document.querySelector('header'); const below = h.firstElementChild.getBoundingClientRect().bottom;
    const rows = [...h.children].filter((c) => !c.matches('.hint, #status') && c.offsetParent !== null && c.getBoundingClientRect().width > 0).some((c) => c.getBoundingClientRect().top >= below) ? 2 : 1;
    const more = document.querySelector('.toolbar-more');
    return { rows, more: !more.hidden, moved: [...more.querySelectorAll('.menu-list > *')].map((x) => x.id), pageWidth: document.documentElement.scrollWidth, width: window.innerWidth };
  })()`);
const at = (selector) => browser.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
const resizeTo = async (width) => {
  await browser.resize(width, 784);
  await wait(500);
};

try {
  browser = await launch();
  await browser.goto(page);
  await browser.evaluate(`localStorage.setItem('eebox:tour-done', 'yes')`);
  await browser.goto(page);
  await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the palette');

  await step('a wide window has every button on the toolbar and no More menu', async () => {
    await resizeTo(1516);
    const s = await state();
    expectTrue(s.rows === 1 && !s.more && s.moved.length === 0, JSON.stringify(s));
  });

  for (const width of [1100, 900, 700, 600]) {
    await step(`at ${width} px the toolbar is on one row, with the least used buttons in More, and the page does not scroll sideways`, async () => {
      await resizeTo(width);
      const s = await state();
      expectTrue(s.rows === 1, `the toolbar is on ${s.rows} rows`);
      expectTrue(s.more && s.moved.length > 0, `nothing is in More: ${JSON.stringify(s)}`);
      expectTrue(s.pageWidth <= s.width, `the page is wider than the window: ${JSON.stringify(s)}`);
      if (width >= 700) expectTrue(!s.moved.includes('undo'), `Undo went into More at ${width} px`);
    });
  }

  await step('a button in More works with a real click, and the menu closes', async () => {
    await resizeTo(800);
    const [mx, my] = await at('#menu-more');
    await browser.mouse('mouseMoved', mx - 3, my - 2);
    await browser.mouse('mousePressed', mx, my);
    await browser.mouse('mouseReleased', mx, my);
    await wait(300);
    expectTrue(await browser.evaluate(`!document.querySelector('.toolbar-more .menu-list').hidden`), 'More did not open');
    const [fx, fy] = await at('#find');
    await browser.mouse('mouseMoved', fx - 3, fy - 2);
    await browser.mouse('mousePressed', fx, fy);
    await browser.mouse('mouseReleased', fx, fy);
    await wait(400);
    expectTrue(await browser.evaluate(`document.querySelector('.toolbar-more .menu-list').hidden`), 'the menu stayed open');
    expectTrue(await browser.evaluate(`document.activeElement.tagName === 'INPUT'`), 'Find did not open');
    await browser.key('Escape', 'Escape', 27);
  });

  await step('the buttons come back when the window is wide again', async () => {
    await resizeTo(1516);
    const s = await state();
    expectTrue(s.rows === 1 && !s.more && s.moved.length === 0, JSON.stringify(s));
    expectTrue(await browser.evaluate(`!document.getElementById('fit').classList.contains('menu-item')`), 'Fit still looks like a menu item');
  });

  await step('at the width of a phone every menu opens inside the window', async () => {
    await resizeTo(390);
    const labels = await browser.evaluate(`[...document.querySelectorAll('header .menu:not(.toolbar-more) .menu-button')].filter((b) => b.offsetParent !== null).map((b) => b.textContent.replace(/\\s*\\u25BE$/, '').trim())`);
    expectTrue(labels.length >= 3, `only ${labels.length} menus on the toolbar`);
    for (const label of labels.concat(['More'])) {
      const outside = await browser.evaluate(`(() => {
        const button = [...document.querySelectorAll('header .menu-button')].find((b) => b.offsetParent !== null && b.textContent.replace(/\\s*\\u25BE$/, '').trim() === ${JSON.stringify(label)});
        button.click();
        const list = button.parentElement.querySelector('.menu-list');
        const r = list.getBoundingClientRect();
        button.click();
        return r.left < 0 || r.right > window.innerWidth ? [Math.round(r.left), Math.round(r.right)] : null;
      })()`);
      expectTrue(outside === null, `the ${label} menu lies at ${outside} in a window ${390} px wide`);
    }
  });

  await step('the toolbar is fitted again when the mode changes', async () => {
    await resizeTo(1000);
    await browser.evaluate(`document.getElementById('mode-schematic').click()`);
    await wait(600);
    const schematic = await state();
    await browser.evaluate(`document.getElementById('mode-panel').click()`);
    await wait(600);
    const panel = await state();
    expectTrue(schematic.rows === 1 && panel.rows === 1, `rows: schematic ${schematic.rows}, panel ${panel.rows}`);
  });

  expectTrue(browser.problems.length === 0, `the page raised errors: ${JSON.stringify(browser.problems)}`);
} finally {
  await browser?.close();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} step(s) failed`);
  process.exit(1);
}
console.log('\ntoolbar test passed');
