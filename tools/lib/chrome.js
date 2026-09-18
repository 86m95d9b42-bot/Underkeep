/**
 * A very small headless Chrome driver over the DevTools protocol, shared by
 * tools/shots.js and tools/check-frames.js.
 *
 * Chrome is used rather than a test browser because the shell leans on things
 * only a real engine gets right: dvh units, env() safe areas, and the way a
 * grid resolves --u. No dependencies — Node's own WebSocket does the work.
 */
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Starts Chrome, attaches to one blank tab, and returns a driver for it. */
export async function openChrome() {
  const profile = join(tmpdir(), `underkeep-${process.pid}-${Math.random().toString(36).slice(2)}`);
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  // Chrome prints its DevTools URL on stderr once it is listening.
  const endpoint = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not start')), 15000);
    chrome.stderr.on('data', (chunk) => {
      buffer += chunk;
      const match = buffer.match(/ws:\/\/\S+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    chrome.on('exit', () => reject(new Error(`Could not run Chrome at ${CHROME}`)));
  });

  const socket = new WebSocket(endpoint);
  const pending = new Map();
  let nextId = 1;

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(
        JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }),
      );
    });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });

  /** @param {string} method @param {object} [params] */
  const page = (method, params) => send(method, params, sessionId);

  return {
    page,

    /** @param {number} width @param {number} height */
    setSize: (width, height, deviceScaleFactor = 2) =>
      page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: true }),

    /**
     * Opens a URL. Blanks the page first, because a change of fragment alone
     * does not reload, and the screen a fragment names would never appear.
     */
    async open(url, settleMs = 700) {
      await page('Page.navigate', { url: 'about:blank' });
      await wait(120);
      await page('Page.navigate', { url });
      await wait(settleMs);
    },

    /** Runs an expression in the page and returns its value. */
    async evaluate(expression) {
      const { result, exceptionDetails } = await page('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'page threw');
      return result.value;
    },

    /** @returns {Promise<Buffer>} */
    async screenshot() {
      const { data } = await page('Page.captureScreenshot', { format: 'png' });
      return Buffer.from(data, 'base64');
    },

    async close() {
      socket.close();
      chrome.kill();
      // Chrome writes to its profile for a moment after the kill; a failed
      // cleanup is not worth failing a run over.
      await wait(200);
      await rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
    },
  };
}

/** The device sizes the build outline's testing section names. */
export const SIZES = [
  { name: 'phone-small-tall', width: 360, height: 780 },
  { name: 'phone-tall', width: 390, height: 844 },
  { name: 'phone-wide', width: 844, height: 390 },
  { name: 'tablet-tall', width: 820, height: 1180 },
  { name: 'tablet-wide', width: 1180, height: 820 },
  { name: 'tablet-wide-large', width: 1366, height: 1024 },
];
