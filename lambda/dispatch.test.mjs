import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dispatch } from './dispatch.mjs';

test('starts daily.yml on master with the token', async () => {
  let call;
  await dispatch('secret', async (url, options) => {
    call = { url, options };
    return new Response(null, { status: 204 });
  });
  assert.equal(call.url, 'https://api.github.com/repos/andrewmacheret/canary/actions/workflows/daily.yml/dispatches');
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.headers.Authorization, 'Bearer secret');
  assert.deepEqual(JSON.parse(call.options.body), { ref: 'master' });
});

test('throws when GitHub says no, like when the token expired', async () => {
  await assert.rejects(
    dispatch('expired', async () => new Response('{"message":"Bad credentials"}', { status: 401 })),
    /401 .*Bad credentials/
  );
});
