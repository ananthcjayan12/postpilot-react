#!/usr/bin/env node
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { inspectProviders, generate } from './providers.mjs';

const dir = path.join(homedir(), '.postpilot'),
  file = path.join(dir, 'companion.json');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let config,
  stopping = false,
  active;
function origin(value) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    throw new Error('Use the HTTPS PostPilot origin, or HTTP localhost for development.');
  return url.origin;
}
async function request(endpoint, body, token = config?.token) {
  const response = await fetch(`${config.origin}/api/companion${endpoint}`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw Object.assign(new Error(`Companion request failed (${response.status})`), {
      status: response.status,
    });
  return response.json();
}
async function main() {
  const action = process.argv[2] || 'start';
  if (action === 'pair') {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      config = { origin: origin(await prompt.question('PostPilot URL: ')) };
      const code = (await prompt.question('One-time pairing code from Settings: ')).trim();
      const paired = await request('/pair', { code, name: hostname().slice(0, 80) }, null);
      config = { ...config, token: paired.token, id: paired.id };
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(file, JSON.stringify(config), { mode: 0o600 });
      await chmod(file, 0o600);
      console.log('Paired. Run npm run companion to connect this computer.');
    } finally {
      prompt.close();
    }
    return;
  }
  if (action === 'doctor') {
    console.log(JSON.stringify(await inspectProviders(), null, 2));
    return;
  }
  if (action !== 'start') throw new Error('Usage: companion [start|pair|doctor]');
  config = JSON.parse(
    await readFile(file, 'utf8').catch(() => {
      throw new Error('Pair first: npm run companion -- pair');
    }),
  );
  config.origin = origin(config.origin);
  for (const sig of ['SIGINT', 'SIGTERM'])
    process.on(sig, () => {
      stopping = true;
      active?.abort();
    });
  console.log(`Connecting to ${config.origin}. Keep this process running for local generation.`);
  let caps,
    checked = 0;
  while (!stopping) {
    try {
      if (Date.now() - checked > 60000) {
        caps = await inspectProviders();
        checked = Date.now();
      }
      const { job } = await request('/poll', caps);
      if (!job) {
        await sleep(3000);
        continue;
      }
      console.log(`${job.provider}: ${job.task} started`);
      const controller = new AbortController();
      active = controller;
      let heartbeatBusy = false;
      const heartbeat = setInterval(async () => {
        if (heartbeatBusy) return;
        heartbeatBusy = true;
        try {
          const state = await request(`/jobs/${job.id}/heartbeat`, { lease: job.lease });
          if (!state.active) controller.abort();
        } catch {
          controller.abort();
        } finally {
          heartbeatBusy = false;
        }
      }, 15000);
      try {
        let completion;
        try {
          completion = { lease: job.lease, result: await generate(job, active.signal) };
        } catch (error) {
          console.error(error.message);
          completion = { lease: job.lease, error: 'generation_failed' };
        }
        // Retry delivery only, never generation. Completion is idempotent.
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await request(`/jobs/${job.id}/complete`, completion);
            break;
          } catch (error) {
            if ([401, 409].includes(error.status) || attempt === 2) throw error;
            await sleep(1000 * 2 ** attempt);
          }
        }
        console.log('Job finished.');
      } finally {
        clearInterval(heartbeat);
        active = undefined;
      }
    } catch (error) {
      console.error(error.message);
      if (error.status === 401) throw new Error('Device access revoked. Pair again in Settings.');
      if (!stopping) await sleep(5000);
    }
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
