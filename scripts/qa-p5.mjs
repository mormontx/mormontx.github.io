#!/usr/bin/env node
/**
 * QA pass 5: capture the unstable-prompt model at rest, mid-buckle (burst),
 * exploded, and the home archive thumbnail. The buckle is a 9s periodic motion
 * inside the WebGL canvas, so we capture a dense burst and pick the slipped
 * frame afterward with a Python pixel pass (see qa/p5-pick.mjs for the logic
 * that writes qa/p5-prompt-rest.png and qa/p5-prompt-buckle.png).
 *
 *   node scripts/qa-p5.mjs
 *
 * Reuses the headless-Chrome-over-CDP pattern from scripts/shoot.mjs against
 * the already-running dev server on 127.0.0.1:4337.
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
  const r = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
  });
  const binary = atob(r.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  writeFileSync(resolve(out), bytes);
  return bytes.length;
}

// Scroll the viewer into centre, wait for the canvas, stop the idle orbit.
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

async function main() {
  const port = 9323 + Math.floor(Math.random() * 400);
  const profile = resolve(join('qa', '.tmp-chrome', `qa-p5-${process.pid}-${Date.now()}`));
  const tmpDir = resolve(join('qa', '.tmp-p5'));
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(dirname(resolve('qa/p5-prompt-rest.png')), { recursive: true });

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

  let cdp = null;
  try {
    await waitJson(port);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((t) => t.type === 'page');
    cdp = await CDP.connect(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');

    // ---- detail page: burst to catch the buckle, then exploded view ----
    await navigate(cdp, `${BASE}/structures/02-the-unstable-prompt/`, 1440, 900, 1);
    const prepared = await evalJs(cdp, PREPARE);
    console.log(`prepare ${prepared}`);
    await sleep(400);

    const canvasRect = JSON.parse(
      await evalJs(
        cdp,
        `JSON.stringify((() => {
          const c = document.querySelector('[data-structure-viewer] canvas');
          const r = c.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        })())`,
      ),
    );
    console.log(`detail canvas rect ${JSON.stringify(canvasRect)}`);

    // Dense burst spanning a little over one 9s buckle period. Frames are saved
    // with wall-clock timestamps so the picker can reason about phase.
    const frameMeta = [];
    const burstStart = Date.now();
    const frames = 130;
    for (let i = 0; i < frames; i += 1) {
      const t0 = Date.now();
      const file = join(tmpDir, `frame-${String(i).padStart(3, '0')}.png`);
      await screenshot(cdp, file);
      const elapsed = Date.now() - burstStart;
      frameMeta.push({ i, file, elapsed });
      if (i % 10 === 0) console.log(`burst ${i}/${frames} @ ${elapsed}ms`);
    }
    writeFileSync(
      join(tmpDir, 'frames.json'),
      JSON.stringify({ canvasRect, frameMeta }, null, 2),
    );
    console.log(`burst done: ${frames} frames over ${Date.now() - burstStart}ms`);

    // Exploded view.
    const exploded = await evalJs(
      cdp,
      `(async () => {
        const panel = document.querySelector('[data-structure-viewer]');
        const btn = Array.from(panel.querySelectorAll('button[type="button"]')).find(b => b.textContent.includes('EXPLODED VIEW'));
        if (!btn) return 'no-button';
        btn.click();
        return 'ok';
      })()`,
    );
    console.log(`explode ${exploded}`);
    await sleep(1500);
    await screenshot(cdp, 'qa/p5-prompt-exploded.png');

    // ---- home page archive section, model 02 hovered ----
    await navigate(cdp, `${BASE}/`, 1440, 900, 1);
    await evalJs(cdp, `window.scrollTo(0, 0);`);
    const archive = await evalJs(
      cdp,
      `(async () => {
        document.documentElement.style.scrollBehavior = 'auto';
        const anchor = document.querySelector('a[href="/structures/02-the-unstable-prompt/"]');
        if (!anchor) return 'no-anchor';
        anchor.scrollIntoView({ block: 'center', inline: 'nearest' });
        anchor.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        const deadline = Date.now() + 6000;
        let canvas = null;
        while (Date.now() < deadline) {
          canvas = document.querySelector('#archive canvas');
          if (canvas) break;
          await new Promise(r => setTimeout(r, 100));
        }
        return canvas ? 'ok' : 'no-canvas';
      })()`,
    );
    console.log(`archive ${archive}`);
    await sleep(1200);
    await screenshot(cdp, 'qa/p5-index.png');

    console.log('capture complete');
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
