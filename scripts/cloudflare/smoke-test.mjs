import { readFile, appendFile } from 'node:fs/promises';
const { origin } = JSON.parse(await readFile('.cloudflare-state.json', 'utf8'));
let lastError;
for (let attempt = 0; attempt < 8; attempt++) {
  try {
    const health = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(15000) });
    if (!health.ok || (await health.json()).service !== 'postpilot-worker')
      throw new Error('Worker health response invalid.');
    const api = await fetch(`${origin}/api/posts`);
    if (api.status !== 401 || !api.headers.get('content-type')?.includes('application/json'))
      throw new Error('Private API did not deny unauthenticated access.');
    const spa = await fetch(`${origin}/calendar`, { headers: { 'Sec-Fetch-Mode': 'navigate' } });
    if (!spa.ok || !spa.headers.get('content-type')?.includes('text/html'))
      throw new Error('React navigation failed.');
    const delivery = await fetch(`${origin}/media-delivery/invalid`);
    if (delivery.status !== 403) throw new Error('Unsigned media was not rejected.');
    const summary =
      'Health, React navigation, private API, and unsigned-media checks passed. Provider publishing was not exercised.';
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n${summary}\n`);
    lastError = null;
    break;
  } catch (e) {
    lastError = e;
    if (attempt < 7) await new Promise((r) => setTimeout(r, 5000));
  }
}
if (lastError) throw lastError;
