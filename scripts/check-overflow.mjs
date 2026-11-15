#!/usr/bin/env node
// Check horizontal overflow at given widths across the listed routes.
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:4330';
const ROUTES = ['/', '/notes/', '/about/', '/register/', '/structures/01-the-dialectic-room/'];
const WIDTHS = [390, 1440];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const onmsg = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id === id) {
          this.ws.removeEventListener('message', onmsg);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      };
      this.ws.addEventListener('message', onmsg);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onopen = () => resolve(new CDP(ws));
      ws.onerror = reject;
    });
  }
}

async function waitJson(port) {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return; } catch {}
    await sleep(120);
  }
  throw new Error('chrome not ready');
}

async function main() {
  const port = 9823 + Math.floor(Math.random() * 200);
  const profile = resolve(join('qa', '.tmp-chrome', `dsh-overflow-${process.pid}-${Date.now()}`));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--single-process',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--window-size=1440,900', '--force-device-scale-factor=1', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: 'ignore' });

  let cdp;
  try {
    await waitJson(port);
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    cdp = await CDP.connect(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    for (const width of WIDTHS) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
      for (const route of ROUTES) {
        await cdp.send('Page.navigate', { url: BASE + route });
        await sleep(2500);
        const expr = 'JSON.stringify({sw:document.body.scrollWidth, cw:document.documentElement.clientWidth, ok:document.body.scrollWidth===document.documentElement.clientWidth})';
        const res = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true });
        const v = JSON.parse(res.result.value);
        console.log(`${width}px ${route}  scrollWidth=${v.sw} clientWidth=${v.cw}  ${v.ok ? 'OK' : 'OVERFLOW'}`);
      }
    }
  } finally {
    if (cdp) cdp.ws.close();
    chrome.kill('SIGKILL');
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
