#!/usr/bin/env node
/**
 * QA pass 2: screenshot each structure viewer fully in frame (scrolled to
 * centre), stop the idle auto-rotation, optionally toggle EXPLODED VIEW, and
 * record canvas/panel geometry so a separate pixel pass can measure the model
 * bounding box and padding.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const CHROME =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:4337';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = new Map();
    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        const e = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? e.reject(new Error(msg.error.message)) : e.resolve(msg.result);
        return;
      }
      if (msg.method) for (const h of this.events.get(msg.method) ?? []) h(msg.params);
    };
    ws.onclose = () => {
      for (const e of this.pending.values()) e.reject(new Error('closed'));
      this.pending.clear();
    };
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onopen = () => resolve(new CDP(ws));
      ws.onerror = reject;
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, h) {
    const hs = this.events.get(method) ?? [];
    hs.push(h);
    this.events.set(method, hs);
  }
  close() {
    try {
      this.ws.close();
    } catch {
      /* noop */
    }
  }
}

async function waitJson(port) {
  for (let i = 0; i < 150; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return;
    } catch {
      /* noop */
    }
    await sleep(120);
  }
  throw new Error('chrome timeout');
}

async function evalJs(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed');
  }
  return r.result.value;
}

async function idleSettle(cdp) {
  let inFlight = 0;
  let last = Date.now();
  cdp.on('Network.requestWillBeSent', (p) => {
    if (p.type === 'WebSocket') return;
    inFlight += 1;
    last = Date.now();
  });
  cdp.on('Network.loadingFinished', () => {
    inFlight = Math.max(0, inFlight - 1);
    last = Date.now();
  });
  cdp.on('Network.loadingFailed', () => {
    inFlight = Math.max(0, inFlight - 1);
    last = Date.now();
  });
  const load = new Promise((r) => cdp.on('Page.loadEventFired', r));
  await Promise.race([load, sleep(10000)]);
  const start = Date.now();
  while (Date.now() - start < 8000) {
    if (inFlight === 0 && Date.now() - last > 500) break;
    await sleep(100);
  }
  await sleep(2500);
}

async function navigate(cdp, url, width, height, dsf = 1) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: dsf,
    mobile: false,
  });
  await cdp.send('Page.navigate', { url });
  await idleSettle(cdp);
}

async function screenshot(cdp, out) {
  const r = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
  });
  const binary = atob(r.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  writeFileSync(resolve(out), bytes);
}

async function gather(cdp) {
  return evalJs(
    cdp,
    `JSON.stringify((() => {
      const panel = document.querySelector('[data-structure-viewer]');
      const canvas = document.querySelector('[data-structure-viewer] canvas');
      const pr = panel ? panel.getBoundingClientRect() : null;
      const cr = canvas ? canvas.getBoundingClientRect() : null;
      const buttons = panel ? Array.from(panel.querySelectorAll('button[type="button"]')).map(b => {
        const r = b.getBoundingClientRect();
        return { text: b.textContent.trim(), width: r.width, height: r.height, ariaPressed: b.getAttribute('aria-pressed') };
      }) : [];
      return {
        panel: pr ? { x: pr.x, y: pr.y, w: pr.width, h: pr.height } : null,
        canvas: cr ? { x: cr.x, y: cr.y, w: cr.width, h: cr.height } : null,
        buttons,
        buttonCount: buttons.length,
        scrollY: window.scrollY,
        hasCanvas: !!canvas,
        devicePixelRatio: window.devicePixelRatio,
      };
    })())`,
  );
}

// Scroll the viewer into centre, wait for hydration, stop the idle orbit, then
// optionally press a control. Returns once the requested control is settled.
const PREPARE = `
(async () => {
  document.documentElement.style.scrollBehavior = 'auto';
  const panel = document.querySelector('[data-structure-viewer]');
  if (!panel) return 'no-panel';
  panel.scrollIntoView({ block: 'center', inline: 'nearest' });

  const deadline = Date.now() + 8000;
  let canvas = null;
  while (Date.now() < deadline) {
    canvas = panel.querySelector('canvas');
    if (canvas) break;
    await new Promise(r => setTimeout(r, 100));
  }
  if (canvas) {
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
  }
  await new Promise(r => setTimeout(r, 120));

  const button = (label) => Array.from(panel.querySelectorAll('button[type="button"]')).find(b => b.textContent.includes(label));
  const action = %%ACTION%%;
  if (action === 'reset') button('RESET VIEW')?.click();
  if (action === 'explode') button('EXPLODED VIEW')?.click();
  return 'ok';
})()
`;

async function main() {
  const port = 9323 + Math.floor(Math.random() * 400);
  const profile = resolve(join('qa', '.tmp-chrome', `qa-p2-${process.pid}-${Date.now()}`));
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--single-process',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--window-size=1440,900',
      '--force-device-scale-factor=1',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const scenarios = [
    { slug: '02-the-unstable-prompt', file: 'qa/p4-prompt-1440.png', width: 1440, height: 900, action: 'reset', dsf: 1 },
    { slug: '02-the-unstable-prompt', file: 'qa/p4-prompt-390.png', width: 390, height: 844, action: 'reset', dsf: 1 },
    { slug: '02-the-unstable-prompt', file: 'qa/p4-prompt-zoom.png', width: 1440, height: 900, action: 'reset', dsf: 2 },
    { slug: '01-the-dialectic-room', file: 'qa/p4-01.png', width: 1440, height: 900, action: 'reset', dsf: 1 },
    { slug: '03-scaffolding-silence', file: 'qa/p4-03.png', width: 1440, height: 900, action: 'reset', dsf: 1 },
    { slug: '04-marginalia-as-dialogue', file: 'qa/p4-04.png', width: 1440, height: 900, action: 'reset', dsf: 1 },
  ];

  const results = [];
  let cdp = null;
  try {
    await waitJson(port);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((t) => t.type === 'page');
    cdp = await CDP.connect(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');

    for (const s of scenarios) {
      mkdirSync(dirname(resolve(s.file)), { recursive: true });
      await navigate(cdp, `${BASE}/structures/${s.slug}/`, s.width, s.height, s.dsf ?? 1);

      const expr = PREPARE.replace('%%ACTION%%', JSON.stringify(s.action));
      await evalJs(cdp, expr);

      const settle = s.action === 'explode' ? 1400 : 700;
      await sleep(settle);

      const meta = JSON.parse(await gather(cdp));
      await screenshot(cdp, s.file);
      results.push({ ...s, ...meta });
      console.log(`${s.file}  viewport ${s.width}x${s.height}  canvas ${meta.canvas ? `${Math.round(meta.canvas.w)}x${Math.round(meta.canvas.h)}` : 'none'}  buttons ${meta.buttonCount}  scrollY ${meta.scrollY}`);
    }

    writeFileSync(resolve('qa/p4-measure.json'), JSON.stringify(results, null, 2));
    console.log('wrote qa/p4-measure.json');
  } finally {
    if (cdp) cdp.close();
    chrome.kill('SIGKILL');
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
