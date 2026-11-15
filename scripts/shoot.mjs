#!/usr/bin/env node
/**
 * Dependency-free headless-Chrome screenshotter over CDP.
 *
 *   node scripts/shoot.mjs --url <url> --width 1440 --height 900 \
 *     --scroll 0 --out qa/x.png
 *
 * Launches Chrome with --remote-debugging-port, talks to it over the global
 * WebSocket available in Node 24, waits for load + network idle + a settle
 * window (so client:idle / client:visible islands hydrate), optionally
 * scrolls, then captures a PNG.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const CHROME =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function parseArgs(argv) {
  const args = {
    url: 'http://127.0.0.1:4321/',
    width: 1440,
    height: 900,
    scroll: 0,
    out: 'qa/shot.png',
    reducedMotion: false,
    noWebgl: false,
    noJs: false,
    eval: '',
    wait: 0,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--url') args.url = value;
    else if (flag === '--width') args.width = Number(value);
    else if (flag === '--height') args.height = Number(value);
    else if (flag === '--scroll') args.scroll = Number(value);
    else if (flag === '--out') args.out = value;
    else if (flag === '--eval') args.eval = value;
    else if (flag === '--wait') args.wait = Number(value);
    else if (flag === '--reduced-motion') args.reducedMotion = true;
    else if (flag === '--no-webgl') args.noWebgl = true;
    else if (flag === '--no-js') args.noJs = true;
    else if (flag === '--help') {
      console.log(
        'Usage: node scripts/shoot.mjs --url <url> --width 1440 --height 900 --scroll 0 --out qa/x.png',
      );
      process.exit(0);
    }
  }

  return args;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
        const entry = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) entry.reject(new Error(msg.error.message));
        else entry.resolve(msg.result);
        return;
      }

      if (msg.method) {
        const handlers = this.events.get(msg.method) ?? [];
        for (const handler of handlers) handler(msg.params);
      }
    };

    ws.onclose = () => {
      for (const entry of this.pending.values()) {
        entry.reject(new Error('CDP socket closed'));
      }
      this.pending.clear();
    };
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onopen = () => resolve(new CDP(ws));
      ws.onerror = (error) => reject(error);
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
    const handlers = this.events.get(method) ?? [];
    handlers.push(handler);
    this.events.set(method, handlers);
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* noop */
    }
  }
}

async function waitForJsonVersion(port, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return response.json();
    } catch {
      /* chrome not up yet */
    }
    await sleep(120);
  }
  throw new Error('Chrome did not expose the DevTools endpoint in time.');
}

async function getPageTarget(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = await response.json();
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error('No page target found.');
  return page;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = 9323 + Math.floor(Math.random() * 400);
  const profileDir = resolve(
    join('qa', '.tmp-chrome', `dsh-shoot-${process.pid}-${Date.now()}`),
  );

  mkdirSync(dirname(resolve(args.out)), { recursive: true });

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
      `--user-data-dir=${profileDir}`,
      `--window-size=${args.width},${args.height}`,
      '--force-device-scale-factor=1',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio',
      ...(args.noWebgl ? ['--disable-webgl'] : []),
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let cdp = null;
  try {
    await waitForJsonVersion(port);
    const target = await getPageTarget(port);
    cdp = await CDP.connect(target.webSocketDebuggerUrl);

    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');

    // Track network activity for an idle signal. WebSocket upgrades (the Vite
    // HMR socket) never emit loadingFinished, so they are ignored.
    let inFlight = 0;
    let lastActivity = Date.now();
    cdp.on('Network.requestWillBeSent', (params) => {
      if (params.type === 'WebSocket') return;
      inFlight += 1;
      lastActivity = Date.now();
    });
    cdp.on('Network.loadingFinished', () => {
      inFlight = Math.max(0, inFlight - 1);
      lastActivity = Date.now();
    });
    cdp.on('Network.loadingFailed', () => {
      inFlight = Math.max(0, inFlight - 1);
      lastActivity = Date.now();
    });

    const loadFired = new Promise((resolve) => {
      cdp.on('Page.loadEventFired', resolve);
    });

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: args.width,
      height: args.height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    if (args.reducedMotion) {
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      });
    }

    if (args.noJs) {
      await cdp.send('Emulation.setScriptExecutionDisabled', { value: true });
    }

    await cdp.send('Page.navigate', { url: args.url });

    // Load + network idle (quiet for 500ms), then a 2500ms hydration settle.
    await Promise.race([loadFired, sleep(10000)]);

    const idleStart = Date.now();
    while (Date.now() - idleStart < 8000) {
      if (inFlight === 0 && Date.now() - lastActivity > 500) break;
      await sleep(100);
    }

    await sleep(2500);

    // Optional scroll, followed by a 600ms settle.
    if (args.scroll > 0) {
      await cdp.send('Runtime.evaluate', {
        expression: `window.scrollTo(0, ${args.scroll});`,
      });
      await sleep(600);
    }

    // Optional client-side interaction (e.g. clicking a control) before capture.
    if (args.eval) {
      await cdp.send('Runtime.evaluate', {
        expression: args.eval,
        awaitPromise: true,
        returnByValue: true,
      });
      if (args.wait > 0) await sleep(args.wait);
    }

    const viewport = await cdp.send('Runtime.evaluate', {
      expression:
        'JSON.stringify({ innerWidth, innerHeight, devicePixelRatio })',
      returnByValue: true,
    });
    console.log(`[shoot] viewport ${viewport.result.value}`);

    const result = await Promise.race([
      cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
      }),
      sleep(10000).then(() => {
        throw new Error('Page.captureScreenshot timed out');
      }),
    ]);

    const binary = atob(result.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    writeFileSync(resolve(args.out), bytes);
    console.log(`wrote ${args.out} (${bytes.length} bytes)`);
  } finally {
    if (cdp) cdp.close();
    chrome.kill('SIGKILL');
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      /* profile may be held briefly; leave it for the OS to reclaim */
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
