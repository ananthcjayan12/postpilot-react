import { test } from 'node:test';
import assert from 'node:assert/strict';
import { command, parseResult, generate } from './providers.mjs';

test('preserves Malayalam and rejects invalid structured content', () => {
  assert.deepEqual(parseResult('thumbnailCopy', '{"thumbnailText":"മലയാളം headline"}'), {
    thumbnailText: 'മലയാളം headline',
  });
  assert.throws(() => parseResult('hashtags', '{"hashtags":"plain text"}'));
  assert.throws(() => parseResult('thumbnailCopy', { thumbnailText: 'x', command: 'rm' }));
});
test('passes shell metacharacters literally through stdin', async () => {
  const input = '$(echo secret); `ls`';
  assert.equal(
    await command(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { input }),
    input,
  );
});
test('terminates a timed out process', async () => {
  await assert.rejects(
    command(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 40 }),
    /timed out/,
  );
});
test('cancels and bounds process output', async () => {
  const controller = new AbortController();
  const result = command(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: controller.signal });
  controller.abort();
  await assert.rejects(result, /cancelled/);
  await assert.rejects(
    command(process.execPath, ['-e', "process.stdout.write('x'.repeat(600000))"]),
    /limit/,
  );
});
test('rejects unsupported tasks without starting a CLI', async () => {
  await assert.rejects(generate({ provider: 'shell', task: 'execute' }), /Unsupported/);
});
