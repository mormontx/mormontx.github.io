#!/usr/bin/env node
/**
 * Phase 4 functional checks over CDP (no screenshotting):
 *   - aria-pressed toggle round-trip
 *   - horizontal overflow at 390 and 1440 on all four dossiers
 *   - vertical swipe over the canvas still scrolls the page on mobile
 */
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CHROME =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://localhost:4325';

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
        if (msg.error) e.reject(new Error(msg.error.message));
        else e.resolve(msg.result);
        return;
      }
      if (msg.method) {
        for (const h of this.events.get(msg.method) ?? []) h(msg.params);
      }
    };
    ws.onclose = () => {
      for (const e of this.pending.values())
        e.reject(new Error('CDP socket closed'));
      this.pending.clear();
    };
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onopen = () => resolve(new CDP(ws));
      ws.onerror = (e) => reject(e);
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, handler) {
    const hs = this.events.get(method) ?? [];
    hs.push(handler);
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

async function waitJson(port, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return r.json();
    } catch {
      /* noop */
    }
    await sleep(120);
  }
  throw new Error('Chrome endpoint timeout');
}

async function getPageTarget(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = await r.json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  return page;
}

async function evalJs(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    throw new Error(
      r.exceptionDetails.exception?.description ?? 'eval failed',
    );
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
  const loadFired = new Promise((r) => cdp.on('Page.loadEventFired', r));
  await Promise.race([loadFired, sleep(10000)]);
  const start = Date.now();
  while (Date.now() - start < 8000) {
    if (inFlight === 0 && Date.now() - last > 500) break;
    await sleep(100);
  }
  await sleep(2500);
}

async function navigate(cdp, url, width, height, mobile) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
  });
  if (mobile) {
    await cdp.send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 1,
    });
  }
  await cdp.send('Page.navigate', { url });
  await idleSettle(cdp);
}

async function main() {
  const port = 9323 + Math.floor(Math.random() * 400);
  const profile = resolve(
    join('qa', '.tmp-chrome', `qa-p4-${process.pid}-${Date.now()}`),
  );
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--disable-crash-reporter',
      '--disable-breakpad',
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
    const target = await getPageTarget(port);
    cdp = await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');

    console.log('--- aria-pressed toggle (structure 01 @1440) ---');
    await navigate(
      cdp,
      `${BASE}/structures/01-the-dialectic-room/`,
      1440,
      900,
      false,
    );
    const before = await evalJs(
      cdp,
      `(() => { const b = document.querySelector('[aria-pressed]'); return b ? b.getAttribute('aria-pressed') : 'MISSING'; })()`,
    );
    await evalJs(cdp, `document.querySelector('[aria-pressed]').click()`);
    await sleep(400);
    const afterOn = await evalJs(
      cdp,
      `(() => { const b = document.querySelector('[aria-pressed]'); return b ? b.getAttribute('aria-pressed') + ' / ' + b.textContent.trim() : 'MISSING'; })()`,
    );
    await evalJs(cdp, `document.querySelector('[aria-pressed]').click()`);
    await sleep(400);
    const afterOff = await evalJs(
      cdp,
      `(() => { const b = document.querySelector('[aria-pressed]'); return b ? b.getAttribute('aria-pressed') + ' / ' + b.textContent.trim() : 'MISSING'; })()`,
    );
    console.log('before:', before);
    console.log('after click 1:', afterOn);
    console.log('after click 2:', afterOff);

    console.log('\n--- horizontal overflow (4 dossiers x 390/1440) ---');
    const slugs = [
      '01-the-dialectic-room',
      '02-the-unstable-prompt',
      '03-scaffolding-silence',
      '04-marginalia-as-dialogue',
    ];
    for (const width of [390, 1440]) {
      for (const slug of slugs) {
        await navigate(cdp, `${BASE}/structures/${slug}/`, width, 844, false);
        const r = await evalJs(
          cdp,
          `JSON.stringify({ scrollWidth: document.body.scrollWidth, clientWidth: document.documentElement.clientWidth, ok: document.body.scrollWidth === document.documentElement.clientWidth })`,
        );
        console.log(`${slug} @${width}: ${r}`);
      }
    }

    console.log('\n--- mobile vertical swipe over canvas (structure 01 @390) ---');
    await navigate(
      cdp,
      `${BASE}/structures/01-the-dialectic-room/`,
      390,
      844,
      true,
    );
    const rect = await evalJs(
      cdp,
      `(() => { const c = document.querySelector('canvas'); if (!c) return null; const r = c.getBoundingClientRect(); return JSON.stringify({x:r.x, y:r.y, w:r.width, h:r.height, scrollY: window.scrollY}); })()`,
    );
    console.log('canvas rect + initial scrollY:', rect);
    const beforeScroll = await evalJs(cdp, `window.scrollY`);
    const parsed = rect ? JSON.parse(rect) : null;
    if (parsed && parsed.w > 0) {
      const x = Math.round(parsed.x + parsed.w / 2);
      const yStart = Math.round(parsed.y + parsed.h * 0.75);
      const yEnd = Math.round(parsed.y + parsed.h * 0.25);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y: yStart }],
      });
      for (let i = 1; i <= 8; i += 1) {
        const y = Math.round(yStart + ((yEnd - yStart) * i) / 8);
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x, y }],
        });
        await sleep(30);
      }
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
      await sleep(800);
    }
    const afterScroll = await evalJs(cdp, `window.scrollY`);
    console.log('scrollY before:', beforeScroll, 'after:', afterScroll);
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
