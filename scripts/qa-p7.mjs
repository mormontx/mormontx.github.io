#!/usr/bin/env node
/**
 * QA pass 7: capture the re-framed unstable-prompt model (1440 rest + burst,
 * 390, archive index) and record each canvas rect so a Python pass can measure
 * padding on all four sides.
 *
 *   node scripts/qa-p7.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed');
  return r.result.value;
}

async function idleSettle(cdp) {
  let inFlight = 0;
  let last = Date.now();
  const onReq = (p) => {
    if (p.type === 'WebSocket') return;
    inFlight += 1;
    last = Date.now();
  };
  const onDone = () => {
    inFlight = Math.max(0, inFlight - 1);
    last = Date.now();
  };
  cdp.on('Network.requestWillBeSent', onReq);
  cdp.on('Network.loadingFinished', onDone);
  cdp.on('Network.loadingFailed', onDone);
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
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const binary = atob(r.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  writeFileSync(resolve(out), bytes);
}

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
  return canvas ? 'ok' : 'no-canvas';
})()
`;

const CANVAS_RECT = `
JSON.stringify((() => {
  const c = document.querySelector('[data-structure-viewer] canvas');
  const r = c.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
})())
`;

async function main() {
  const port = 9323 + Math.floor(Math.random() * 400);
  const profile = resolve(join('qa', '.tmp-chrome', `qa-p7-${process.pid}-${Date.now()}`));
  const tmpDir = resolve(join('qa', '.tmp-p7'));
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(dirname(resolve('qa/p7-prompt-rest.png')), { recursive: true });

  const chrome = spawn(
    CHROME,
    [
      '--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--single-process',
      `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
      '--window-size=1440,900', '--force-device-scale-factor=1', '--hide-scrollbars',
      '--no-first-run', '--no-default-browser-check', '--mute-audio', 'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let cdp = null;
  try {
    await waitJson(port);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((t) => t.type === 'page');
    cdp = await CDP.connect(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');

    // 1440 detail: burst + canvas rect
    await navigate(cdp, `${BASE}/structures/02-the-unstable-prompt/`, 1440, 900, 1);
    console.log(`prepare 1440 ${await evalJs(cdp, PREPARE)}`);
    await sleep(400);
    const rect1440 = JSON.parse(await evalJs(cdp, CANVAS_RECT));
    console.log(`canvas 1440 ${JSON.stringify(rect1440)}`);
    const frameMeta = [];
    const burstStart = Date.now();
    for (let i = 0; i < 130; i += 1) {
      const file = join(tmpDir, `frame-${String(i).padStart(3, '0')}.png`);
      await screenshot(cdp, file);
      frameMeta.push({ i, file, elapsed: Date.now() - burstStart });
      if (i % 20 === 0) console.log(`burst ${i}/130`);
    }
    writeFileSync(join(tmpDir, 'frames.json'), JSON.stringify({ rect1440, frameMeta }, null, 2));

    // 390 detail
    await navigate(cdp, `${BASE}/structures/02-the-unstable-prompt/`, 390, 844, 1);
    console.log(`prepare 390 ${await evalJs(cdp, PREPARE)}`);
    await sleep(400);
    const rect390 = JSON.parse(await evalJs(cdp, CANVAS_RECT));
    console.log(`canvas 390 ${JSON.stringify(rect390)}`);
    await screenshot(cdp, 'qa/p7-390.png');
    writeFileSync(join(tmpDir, 'rect390.json'), JSON.stringify(rect390, null, 2));

    // archive index, model 02 hovered
    await navigate(cdp, `${BASE}/`, 1440, 900, 1);
    const rect = JSON.parse(
      await evalJs(
        cdp,
        `(async () => {
          document.documentElement.style.scrollBehavior='auto';
          const a=document.querySelector('a[href="/structures/02-the-unstable-prompt/"]');
          if(!a) return JSON.stringify({err:'no-anchor'});
          a.scrollIntoView({block:'center',inline:'nearest'});
          await new Promise(r=>setTimeout(r,300));
          const r=a.getBoundingClientRect();
          return JSON.stringify({x:r.x+r.width/2, y:r.y+r.height/2});
        })()`,
      ),
    );
    if (rect.err) throw new Error(rect.err);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
    await sleep(700);
    console.log(`archive footer ${await evalJs(cdp, `document.querySelector('#archive .meta.text-accent')?.textContent?.trim() ?? null`)}`);
    await sleep(900);
    await screenshot(cdp, 'qa/p7-index.png');
    console.log('done');
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
