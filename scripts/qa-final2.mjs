#!/usr/bin/env node
/**
 * Final verification pass 2. Captures the final2-* screenshot set, checks
 * horizontal overflow, and verifies the home hero is a live three.js canvas.
 * Read-only with respect to site source: only writes qa/ artifacts.
 *
 *   node scripts/qa-final2.mjs
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
}

// Wait for the hero to hydrate (canvas + __heroDebug) and report its state.
const HOME_PROBE = `
(async () => {
  document.documentElement.style.scrollBehavior = 'auto';
  window.scrollTo(0, 0);
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (window.__heroDebug && document.querySelector('#hero canvas')) break;
    await new Promise(r => setTimeout(r, 100));
  }
  const canvas = document.querySelector('#hero canvas');
  const body = document.body ? document.body.innerText : '';
  return JSON.stringify({
    debug: !!window.__heroDebug,
    hasCanvas: !!canvas,
    webgl2: canvas ? !!canvas.getContext('webgl2') : false,
    ask: body.includes('ASK A QUESTION'),
    soundOff: body.includes('SOUND OFF'),
    voices: body.includes('VOICES'),
    scrollY: window.scrollY,
  });
})()
`;

// Structure viewer: centre the panel, stop the idle orbit, confirm the canvas.
const VIEWER_PREPARE = `
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
  const wrap = panel.querySelector(':scope > div');
  if (wrap) {
    wrap.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
  }
  await new Promise(r => setTimeout(r, 400));
  const r = canvas ? canvas.getBoundingClientRect() : null;
  return JSON.stringify({
    hasCanvas: !!canvas,
    webgl2: canvas ? !!canvas.getContext('webgl2') : false,
    rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
  });
})()
`;

// Marginalia plate: select the 01B artifact pane (if the switcher exists).
const MARGINALIA_PREPARE = `
(async () => {
  document.documentElement.style.scrollBehavior = 'auto';
  const sw = document.querySelector('[data-plate-switcher]');
  if (!sw) return 'no-switcher';
  sw.scrollIntoView({ block: 'center', inline: 'nearest' });
  await new Promise(r => setTimeout(r, 200));
  const btn = sw.querySelector('[data-plate-mode="artifact"]');
  if (btn) btn.click();
  await new Promise(r => setTimeout(r, 450));
  const panel = sw.querySelector('[data-plate-panel="artifact"]');
  return JSON.stringify({
    clicked: !!btn,
    pressed: btn ? btn.getAttribute('aria-pressed') : null,
    artifactVisible: panel ? !panel.classList.contains('hidden') : false,
    caption: sw.querySelector('[data-plate-caption]')?.textContent ?? null,
  });
})()
`;

async function main() {
  const port = 9323 + Math.floor(Math.random() * 400);
  const profile = resolve(join('qa', '.tmp-chrome', `qa-final2-${process.pid}-${Date.now()}`));
  mkdirSync(resolve('qa'), { recursive: true });

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

  const report = { captures: [], overflow: [], canvasCheck: null, reducedCheck: null };
  let cdp = null;
  try {
    await waitJson(port);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((t) => t.type === 'page');
    cdp = await CDP.connect(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });

    // 1. Home hero, idle, after hydration.
    await navigate(cdp, `${BASE}/`, 1440, 900, 1);
    const hero = JSON.parse(await evalJs(cdp, HOME_PROBE));
    report.canvasCheck = hero;
    console.log(`home 1440 ${JSON.stringify(hero)}`);
    await sleep(400);
    await screenshot(cdp, 'qa/final2-home.png');
    report.captures.push({ file: 'qa/final2-home.png', width: 1440, height: 900, note: 'home hero idle' });

    // 2. Home hero, 3-mirror chord via __heroDebug.select.
    await evalJs(
      cdp,
      `(async () => {
        window.__heroDebug.select(0);
        window.__heroDebug.select(1);
        window.__heroDebug.select(2);
        await new Promise(r => setTimeout(r, 500));
      })()`,
    );
    const chord = await evalJs(
      cdp,
      `JSON.stringify((() => {
        const ps = Array.from(document.querySelectorAll('p.meta'));
        const readout = ps.map(p => p.textContent.trim()).find(t => t.startsWith('VOICES')) ?? null;
        return { readout, reflection: document.body.innerText.includes('REFLECTION') };
      })())`,
    );
    console.log(`home chord ${chord}`);
    await sleep(300);
    await screenshot(cdp, 'qa/final2-home-chord.png');
    report.captures.push({ file: 'qa/final2-home-chord.png', width: 1440, height: 900, note: 'home 3-mirror chord', chord: JSON.parse(chord) });

    // 3. Home mobile, 390x844, top of page.
    await navigate(cdp, `${BASE}/`, 390, 844, 1);
    const mobile = JSON.parse(await evalJs(cdp, HOME_PROBE));
    console.log(`home 390 ${JSON.stringify(mobile)}`);
    await sleep(300);
    await screenshot(cdp, 'qa/final2-home-mobile.png');
    report.captures.push({ file: 'qa/final2-home-mobile.png', width: 390, height: 844, note: 'home mobile top', hero: mobile });

    // 4. Unstable prompt dossier, model in frame.
    await navigate(cdp, `${BASE}/structures/02-the-unstable-prompt/`, 1440, 900, 1);
    const prompt = JSON.parse(await evalJs(cdp, VIEWER_PREPARE));
    console.log(`prompt ${JSON.stringify(prompt)}`);
    await sleep(300);
    await screenshot(cdp, 'qa/final2-prompt.png');
    report.captures.push({ file: 'qa/final2-prompt.png', width: 1440, height: 900, note: 'unstable prompt model', viewer: prompt });

    // 5. Marginalia dossier, 01B artifact pane selected.
    await navigate(cdp, `${BASE}/structures/04-marginalia-as-dialogue/`, 1440, 900, 1);
    const marg = JSON.parse(await evalJs(cdp, MARGINALIA_PREPARE));
    console.log(`marginalia ${JSON.stringify(marg)}`);
    await sleep(300);
    await screenshot(cdp, 'qa/final2-marginalia.png');
    report.captures.push({ file: 'qa/final2-marginalia.png', width: 1440, height: 900, note: 'marginalia 01B artifact', marginalia: marg });

    // 6. Notes index.
    await navigate(cdp, `${BASE}/notes/`, 1440, 900, 1);
    const notesH1 = await evalJs(cdp, `document.querySelector('h1')?.textContent?.trim() ?? null`);
    await screenshot(cdp, 'qa/final2-notes.png');
    report.captures.push({ file: 'qa/final2-notes.png', width: 1440, height: 900, note: 'notes index', h1: notesH1 });
    console.log(`notes h1=${notesH1}`);

    // 7. About.
    await navigate(cdp, `${BASE}/about/`, 1440, 900, 1);
    const aboutH1 = await evalJs(cdp, `document.querySelector('h1')?.textContent?.trim() ?? null`);
    await screenshot(cdp, 'qa/final2-about.png');
    report.captures.push({ file: 'qa/final2-about.png', width: 1440, height: 900, note: 'about', h1: aboutH1 });
    console.log(`about h1=${aboutH1}`);

    // 8. Horizontal overflow at 390 and 1440 on four routes.
    const OVERFLOW_EXPR = `JSON.stringify((() => {
      const de = document.documentElement;
      return { sw: de.scrollWidth, cw: de.clientWidth, ok: de.scrollWidth === de.clientWidth };
    })())`;
    for (const width of [390, 1440]) {
      for (const route of ['/', '/notes/', '/about/', '/structures/01-the-dialectic-room/']) {
        await navigate(cdp, `${BASE}${route}`, width, 844, 1);
        const ov = JSON.parse(await evalJs(cdp, OVERFLOW_EXPR));
        report.overflow.push({ width, route, ...ov });
        console.log(`overflow ${width}px ${route}  scrollWidth=${ov.sw} clientWidth=${ov.cw}  ${ov.ok ? 'OK' : 'OVERFLOW'}`);
      }
    }

    // 9. Reduced motion: home hero serves the static plate.
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await navigate(cdp, `${BASE}/`, 1440, 900, 1);
    const reduced = JSON.parse(
      await evalJs(
        cdp,
        `(async () => {
          const deadline = Date.now() + 12000;
          while (Date.now() < deadline) {
            if (document.querySelector('#hero svg[aria-label="Plan ring of eighteen chairs with one gap"]')) break;
            await new Promise(r => setTimeout(r, 100));
          }
          return JSON.stringify({
            fallback: !!document.querySelector('#hero svg[aria-label="Plan ring of eighteen chairs with one gap"]'),
            canvas: !!document.querySelector('#hero canvas'),
            debug: !!window.__heroDebug,
          });
        })()`,
      ),
    );
    report.reducedCheck = reduced;
    console.log(`reduced ${JSON.stringify(reduced)}`);
    await sleep(300);
    await screenshot(cdp, 'qa/final2-reduced.png');
    report.captures.push({ file: 'qa/final2-reduced.png', width: 1440, height: 900, note: 'home reduced motion', reduced });
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });

    writeFileSync(resolve('qa/final2-report.json'), JSON.stringify(report, null, 2));
    console.log('wrote qa/final2-report.json');
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
