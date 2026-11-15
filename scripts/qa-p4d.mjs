#!/usr/bin/env node
/** Phase 4d legibility re-capture (edges + sheet value step). */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
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
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.id != null && this.pending.has(msg.id)) {
        const e = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? e.reject(new Error(msg.error.message)) : e.resolve(msg.result);
        return;
      }
      if (msg.method) for (const h of this.events.get(msg.method) ?? []) h(msg.params);
    };
    ws.onclose = () => { for (const e of this.pending.values()) e.reject(new Error('closed')); this.pending.clear(); };
  }
  static connect(url) { return new Promise((res, rej) => { const ws = new WebSocket(url); ws.onopen = () => res(new CDP(ws)); ws.onerror = rej; }); }
  send(method, params = {}) { return new Promise((res, rej) => { const id = ++this.id; this.pending.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  on(method, h) { const hs = this.events.get(method) ?? []; hs.push(h); this.events.set(method, hs); }
  close() { try { this.ws.close(); } catch { /* noop */ } }
}

async function waitJson(port) { for (let i = 0; i < 150; i += 1) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return; } catch { /* noop */ } await sleep(120); } throw new Error('chrome timeout'); }
async function evalJs(cdp, expression) { const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed'); return r.result.value; }

async function idleSettle(cdp) {
  let inflight = 0; let last = Date.now();
  cdp.on('Network.requestWillBeSent', (p) => { if (p.type === 'WebSocket') return; inflight += 1; last = Date.now(); });
  cdp.on('Network.loadingFinished', () => { inflight = Math.max(0, inflight - 1); last = Date.now(); });
  cdp.on('Network.loadingFailed', () => { inflight = Math.max(0, inflight - 1); last = Date.now(); });
  const load = new Promise((r) => cdp.on('Page.loadEventFired', r));
  await Promise.race([load, sleep(10000)]);
  const start = Date.now();
  while (Date.now() - start < 8000) { if (inflight === 0 && Date.now() - last > 500) break; await sleep(100); }
  await sleep(2500);
}

async function navigate(cdp, url, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  await cdp.send('Page.navigate', { url });
  await idleSettle(cdp);
}

async function canvasRect(cdp) {
  return evalJs(cdp, `(() => { const c = document.querySelector('canvas'); if (!c) return null; const r = c.getBoundingClientRect(); return {x:r.x, y:r.y, w:r.width, h:r.height}; })()`);
}

async function shot(cdp, out) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const b = atob(r.data); const bytes = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i += 1) bytes[i] = b.charCodeAt(i);
  writeFileSync(resolve(out), bytes);
}

async function main() {
  const port = 9323 + Math.floor(Math.random() * 400);
  const profile = resolve(join('qa', '.tmp-chrome', `qa-p4d-${process.pid}-${Date.now()}`));
  const chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu-sandbox','--single-process',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--window-size=1440,900','--force-device-scale-factor=1','--hide-scrollbars','--no-first-run','--no-default-browser-check','--mute-audio','about:blank'], { stdio: 'ignore' });

  const scenarios = [
    { slug: '02-the-unstable-prompt', file: 'qa/p4d-dossier-02.png', width: 1440, height: 900, exploded: false },
    { slug: '04-marginalia-as-dialogue', file: 'qa/p4d-dossier-04.png', width: 1440, height: 900, exploded: false },
    { slug: '04-marginalia-as-dialogue', file: 'qa/p4d-dossier-04-exploded.png', width: 1440, height: 900, exploded: true },
    { slug: '01-the-dialectic-room', file: 'qa/p4d-dossier-01.png', width: 1440, height: 900, exploded: false },
    { slug: '01-the-dialectic-room', file: 'qa/p4d-dossier-390.png', width: 390, height: 844, exploded: false },
  ];

  let cdp = null;
  try {
    await waitJson(port);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    cdp = await CDP.connect(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await cdp.send('Page.enable'); await cdp.send('Network.enable'); await cdp.send('Runtime.enable');
    for (const s of scenarios) {
      mkdirSync(dirname(resolve(s.file)), { recursive: true });
      await navigate(cdp, `${BASE}/structures/${s.slug}/`, s.width, s.height);
      await evalJs(cdp, `document.querySelector('[data-structure-viewer]').scrollIntoView({ block: 'center', inline: 'nearest' })`);
      await sleep(700);
      if (s.exploded) { await evalJs(cdp, `document.querySelector('[data-structure-viewer] [aria-pressed]').click()`); await sleep(1300); }
      const rect = await canvasRect(cdp);
      await shot(cdp, s.file);
      console.log(`${s.file}  ${s.width}x${s.height}  exploded=${s.exploded}  canvas=${JSON.stringify(rect)}`);
    }
  } finally {
    if (cdp) cdp.close();
    chrome.kill('SIGKILL');
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
