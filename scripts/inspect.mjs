#!/usr/bin/env node
// One-off DOM inspector over CDP for the dossier page (verification helper).
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = process.argv[2] || 'http://127.0.0.1:4330/structures/01-the-dialectic-room/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onopen = () => resolve(new CDP(ws));
      ws.onerror = reject;
    });
  }
  onopen() {}
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
}

async function jsonVersion(port) {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return r.json(); } catch {}
    await sleep(120);
  }
  throw new Error('chrome not ready');
}

async function main() {
  const port = 9623 + Math.floor(Math.random() * 300);
  const profile = resolve(join('qa', '.tmp-chrome', `dsh-inspect-${process.pid}-${Date.now()}`));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--single-process',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--window-size=1440,900', '--force-device-scale-factor=1', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: 'ignore' });

  let cdp;
  try {
    await jsonVersion(port);
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    cdp = await CDP.connect(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url });
    await sleep(4000);

    const expr = `(async()=>{
      document.documentElement.style.scrollBehavior='auto';
      const v=document.querySelector('[data-structure-viewer]');
      if(!v) return JSON.stringify({err:'no viewer'});
      v.scrollIntoView({block:'start'});
      const d=Date.now()+8000;
      while(Date.now()<d){
        if(document.querySelector('[data-structure-viewer] canvas')) break;
        await new Promise(r=>setTimeout(r,100));
      }
      await new Promise(r=>setTimeout(r,500));
      const r=v.getBoundingClientRect();
      const c=document.querySelector('[data-structure-viewer] canvas');
      const cr=c?c.getBoundingClientRect():null;
      const f=v.querySelector('footer');
      const fr=f?f.getBoundingClientRect():null;
      const btns=[...v.querySelectorAll('button')].map(b=>b.textContent.trim());
      return JSON.stringify({scrollY:window.scrollY, viewer:{top:r.top,bottom:r.bottom,height:r.height}, canvas:cr?{top:cr.top,bottom:cr.bottom,height:cr.height}:null, footer:fr?{top:fr.top,bottom:fr.bottom,height:fr.height}:null, buttons:btns, hasCanvas:!!c});
    })()`;
    const res = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    console.log(res.result.value);
  } finally {
    if (cdp) cdp.ws.close();
    chrome.kill('SIGKILL');
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
