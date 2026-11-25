// Runs one project's health check and exits with 1 if anything is broken.
//   node check.mjs https://nhl.andrewmacheret.com/healthcheck
// JSON health checks (Lambdas) are read directly. HTML ones (static sites) run their
// checks in the browser, so they're opened in headless Chrome.
import { spawn } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2];
const chrome = process.env.CHROME || 'google-chrome';
const pageTimeoutMs = 60_000;

async function check(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const type = response.headers.get('content-type') || '';
  if (type.includes('application/json')) return response.json();
  if (type.includes('text/html')) return checkInChrome(url);
  throw new Error(`${url} returned ${response.status} ${type}, not a health check`);
}

async function checkInChrome(url) {
  const profile = mkdtempSync(join(tmpdir(), 'canary-'));
  // --no-sandbox because newer Ubuntu runners block Chrome's sandbox
  const browser = spawn(chrome, [
    '--headless=new', '--no-sandbox', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    const cdp = await connect(await devToolsUrl(browser));
    const { targetId } = await cdp.send('Target.createTarget', { url });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    // healthcheck.js sets window.healthcheckResult once every check is done
    const deadline = Date.now() + pageTimeoutMs;
    while (Date.now() < deadline) {
      // This can fail while the page is still navigating, so just try again
      const value = await cdp.send('Runtime.evaluate',
        { expression: 'window.healthcheckResult', returnByValue: true }, sessionId)
        .then(({ result }) => result.value, () => null);
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`${url} didn't finish its checks in ${pageTimeoutMs / 1000} seconds`);
  } finally {
    // Chrome keeps writing to its profile until it exits, so wait before deleting it
    const exited = new Promise((resolve) => browser.once('exit', resolve));
    browser.kill();
    await exited;
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  }
}

// Chrome prints "DevTools listening on ws://..." once it's ready
function devToolsUrl(browser) {
  return new Promise((resolve, reject) => {
    let output = '';
    browser.stderr.on('data', (data) => {
      output += data;
      const match = output.match(/DevTools listening on (ws:\S+)/);
      if (match) resolve(match[1]);
    });
    browser.on('error', reject);
    browser.on('exit', (code) => reject(new Error(`Chrome exited with ${code}:\n${output}`)));
  });
}

// A tiny Chrome DevTools Protocol client, so this needs no npm packages
async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error(`couldn't connect to Chrome at ${wsUrl}`));
  });
  let nextId = 1;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(message.error.message));
    else callback.resolve(message.result);
  };
  socket.onclose = () => {
    for (const callback of pending.values()) callback.reject(new Error('Chrome closed the connection'));
    pending.clear();
  };
  return {
    send(method, params, sessionId) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params, sessionId }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    }
  };
}

// GitHub annotations break on raw newlines, and on : or , in the title
function annotate(title, message) {
  const escape = (text) => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log(`::error title=${escape(title).replace(/:/g, '%3A').replace(/,/g, '%2C')}::${escape(message)}`);
}

function passed(result) {
  const checks = result.checks || [];
  return result.status === 'ok' && checks.length > 0 && checks.every((c) => c.ok);
}

function lines(result) {
  return (result.checks || []).map((c) => `${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? `: ${c.detail}` : ''}`);
}

function report(result) {
  console.log(`${url}\n${lines(result).join('\n')}`);
  for (const c of (result.checks || []).filter((c) => !c.ok)) annotate(c.name, c.detail || 'failed');
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${url}\n\n${lines(result).map((l) => `- ${l}`).join('\n')}\n`);
  }
}

// Returns the health check's result, or { error } if it couldn't be read at all
async function attempt() {
  try {
    return await check(url);
  } catch (err) {
    // Node's "fetch failed" keeps the real reason, like ENOTFOUND, in err.cause
    const reason = err.cause ? ` (${err.cause.code || err.cause.message})` : '';
    return { error: `${url}: ${err.message}${reason}` };
  }
}

// Cold Lambdas and busy third parties sometimes time out once, so a check
// only counts as broken if it fails twice in a row
let result = await attempt();
if (!passed(result)) {
  console.log(`First try failed, trying again in 30 seconds:\n${result.error || lines(result).join('\n')}\n`);
  await new Promise((resolve) => setTimeout(resolve, 30_000));
  result = await attempt();
}
if (result.error) annotate('Health check failed', result.error);
else report(result);
process.exitCode = passed(result) ? 0 : 1;
