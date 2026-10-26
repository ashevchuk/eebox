import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser'];
const PORT = 9400 + Math.floor(Math.random() * 400);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findBrowser() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  for (const name of CANDIDATES) {
    for (const dir of (process.env.PATH ?? '').split(':')) if (existsSync(join(dir, name))) return name;
  }
  throw new Error(`no Chrome or Chromium found; set CHROME_BIN. Looked for: ${CANDIDATES.join(', ')}`);
}

/** Starts a headless browser with a throwaway profile and drives it over the DevTools protocol. */
export async function launch({ width = 1516, height = 784 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'eebox-e2e-'));
  const flags = ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--disable-gpu', '--hide-scrollbars'];
  if (process.env.CI) flags.push('--no-sandbox');
  const child = spawn(findBrowser(), [...flags, 'about:blank'], { stdio: 'ignore' });

  let targets;
  for (let i = 0; i < 100 && !targets; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    } catch {
      await sleep(100);
    }
  }
  if (!targets) {
    child.kill();
    throw new Error('the browser did not start');
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve) => (ws.onopen = resolve));

  let nextId = 0;
  const pending = new Map();
  const problems = [];
  ws.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id !== undefined) return pending.get(data.id)?.(data);
    if (data.method === 'Runtime.exceptionThrown') problems.push(data.params.exceptionDetails.exception?.description ?? data.params.exceptionDetails.text);
    if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') problems.push(data.params.args.map((a) => a.value ?? a.description).join(' '));
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, (data) => (data.error ? reject(new Error(`${method}: ${JSON.stringify(data.error)}`)) : resolve(data.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`in the page: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    return result.result.value;
  };

  return {
    problems,
    evaluate,
    goto: async (url) => {
      await send('Page.navigate', { url });
      await sleep(500);
    },
    /** Waits until `expression` is truthy in the page, and says what it waited for when it never is. */
    waitFor: async (expression, what, timeoutMs = 10000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await evaluate(`Boolean(${expression})`).catch(() => false)) return;
        await sleep(100);
      }
      throw new Error(`timed out waiting for ${what}`);
    },
    /** `modifiers` is the DevTools bit mask: 1 Alt, 2 Ctrl, 4 Meta, 8 Shift. */
    mouse: async (type, x, y, modifiers = 0) => send('Input.dispatchMouseEvent', { type, x, y, modifiers, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 }),
    media: (media) => send('Emulation.setEmulatedMedia', { media }),
    screenshot: async () => Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
    pdf: async () => Buffer.from((await send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true })).data, 'base64'),
    close: async () => {
      ws.close();
      child.kill();
      await sleep(200);
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
