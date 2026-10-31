/**
 * The mark of the author on the files the application writes, in a real browser: a project, a backup and a library
 * say which release wrote them, a file that is refused says which release wrote it, and the same project written by
 * another release is not a new project in the list. Run `npm run build:dist-file` first.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from './browser.mjs';

const page = pathToFileURL(resolve('dist-file/index.html')).href;
const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
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
const download = (id) =>
  browser.evaluate(`(async () => {
    let blob = null; const create = URL.createObjectURL; URL.createObjectURL = (b) => { blob = b; return create(b); };
    const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {};
    document.getElementById(${JSON.stringify(id)}).click(); await new Promise((r) => setTimeout(r, 900));
    HTMLAnchorElement.prototype.click = click; URL.createObjectURL = create;
    return blob ? await blob.text() : null;
  })()`);
const open = (content, name, inputId = 'open-project') =>
  browser.evaluate(`(async () => {
    const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(content)}], ${JSON.stringify(name)}));
    const input = document.getElementById(${JSON.stringify(inputId)}); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Discard')?.click();
    await new Promise((r) => setTimeout(r, 400));
  })()`);
const status = () => browser.evaluate(`document.getElementById('status').textContent`);

try {
  browser = await launch();
  await browser.goto(page);
  await browser.evaluate(`localStorage.setItem('eebox:tour-done', 'yes')`);
  await browser.goto(page);
  await browser.resize(1516, 784);
  await browser.waitFor(`document.querySelectorAll('#palette summary').length > 0`, 'the palette');
  await open(example, 'house-panel.json');
  await browser.waitFor(`document.getElementById('status').textContent.includes('loaded')`, 'the project to load');

  await step('a project file from before the mark opens, and is written with the mark of this release', async () => {
    expectTrue(!/warning|problem/i.test(await status()), await status());
    const text = await download('save-project');
    expectTrue(JSON.parse(text).generator === `eebox ${version}`, `the project says ${JSON.parse(text).generator}`);
  });

  await step('the backup says which release wrote it', async () => {
    const text = await download('backup-all');
    expectTrue(JSON.parse(text).generator === `eebox ${version}`, `the backup says ${JSON.parse(text).generator}`);
  });

  await step('a library exported from the palette says which release wrote it', async () => {
    const text = await browser.evaluate(`(async () => {
      let blob = null; const create = URL.createObjectURL; URL.createObjectURL = (b) => { blob = b; return create(b); };
      const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {};
      [...document.querySelectorAll('#palette .library-title button')].find((b) => b.textContent === 'export').click();
      await new Promise((r) => setTimeout(r, 900));
      HTMLAnchorElement.prototype.click = click; URL.createObjectURL = create;
      return blob ? await blob.text() : null;
    })()`);
    expectTrue(JSON.parse(text).generator === `eebox ${version}`, `the library says ${JSON.parse(text).generator}`);
  });

  await step('a file that is refused says which release wrote it, and a file without a mark says that it does not tell', async () => {
    const broken = JSON.parse(await download('save-project'));
    delete broken.project.panel.plates;
    broken.generator = 'eebox 0.5.0';
    await open(JSON.stringify(broken), 'old.json');
    expectTrue((await status()).includes(`The file was written by eebox 0.5.0; this is eebox ${version}.`), await status());
    delete broken.generator;
    await open(JSON.stringify(broken), 'unmarked.json');
    expectTrue((await status()).includes('does not say which version wrote it'), await status());
  });

  await step('the same project written by another release is not added to the list of projects twice', async () => {
    const mine = JSON.parse(await download('save-project'));
    const other = { ...mine, generator: 'eebox 0.5.0' };
    const count = () => browser.evaluate(`(async () => { document.getElementById('open-projects').click(); await new Promise((r) => setTimeout(r, 600)); const n = document.querySelectorAll('dialog[open] .projects-row').length; document.querySelector('dialog[open]')?.close(); return n; })()`);
    const importInto = (file) => browser.evaluate(`(async () => {
      document.getElementById('open-projects').click(); await new Promise((r) => setTimeout(r, 500));
      const input = document.querySelector('dialog[open] input[type=file]');
      const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(JSON.stringify(file))}], 'p.eebox.json'));
      input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 900));
      const text = document.querySelector('dialog[open]').innerText; document.querySelector('dialog[open]').close(); return text;
    })()`);
    await importInto(mine);
    const first = await count();
    expectTrue(first >= 1, `the project was not put in the list at all (${first} rows)`);
    await importInto(other);
    expectTrue((await count()) === first, 'the same project of another release was added again');
  });

  expectTrue(browser.problems.length === 0, `the page raised errors: ${JSON.stringify(browser.problems)}`);
} finally {
  await browser?.close();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} step(s) failed`);
  process.exit(1);
}
console.log('\nfile version test passed');
