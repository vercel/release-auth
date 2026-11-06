const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const source = readFileSync(join(__dirname, '../api/server.js'), 'utf8');
const browserIP = '203.0.113.10';
const otherIP = '203.0.113.20';
const state = 'legacy-client-state';
const callback = { code: 'test-code', state };

function createServer(exchange = async () => ({
  ok: true,
  json: async () => ({ access_token: 'test-token' }),
}), env = {}) {
  let now = Date.now();
  const exchanges = [];
  const logs = [];
  const buffers = [];
  const module = { exports: {} };
  runInNewContext(source, {
    module,
    AbortSignal,
    Buffer: {
      from(value) {
        const buffer = Buffer.from(value);
        buffers.push(buffer);
        return buffer;
      },
    },
    Date: { now: () => now },
    process: { env: { CLIENT_ID: 'test-client', CLIENT_SECRET: 'test-secret', VERCEL: '1', ...env } },
    console: { error: (...args) => logs.push(args) },
    require,
    async fetch(...args) {
      exchanges.push(args);
      return exchange(...args);
    },
  });

  return {
    exchanges,
    logs,
    buffers,
    advance(milliseconds) { now += milliseconds; },
    async request(query = {}, {
      ip = browserIP,
      headers = {},
      socketAddress = '10.0.0.1',
      method = 'GET',
      failJSON = false,
    } = {}) {
      const response = {
        statusCode: 200,
        headers: {},
        setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
        status(code) { this.statusCode = code; return this; },
        json(body) {
          if (failJSON) throw new Error('Response failed');
          this.body = JSON.parse(JSON.stringify(body));
          return this;
        },
        end(body) { this.body = body; return this; },
      };
      await module.exports({
        query,
        headers: { ...(ip === null ? {} : { 'x-real-ip': ip }), ...headers },
        socket: { remoteAddress: socketAddress },
        method,
      }, response);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(response.headers['referrer-policy'], 'no-referrer');
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
      return response;
    },
  };
}

test('preserves legacy callbacks and polling without cookies or extra client parameters', async () => {
  const server = createServer();
  const pending = await server.request({ state });
  assert.equal(pending.statusCode, 403);
  assert.deepEqual(pending.body, { error: 'state_not_defined' });

  const authorized = await server.request(callback);
  assert.equal(authorized.statusCode, 200);
  assert.equal(authorized.body, 'Done. You can close this window now!');
  assert.equal(authorized.headers['set-cookie'], undefined);
  const retrieved = await server.request({ state });
  assert.equal(retrieved.statusCode, 200);
  assert.deepEqual(retrieved.body, { token: 'test-token' });
  assert.equal((await server.request({ state })).statusCode, 403);
  assert.ok(server.buffers[0].every(byte => byte === 0));

  const [url, options] = server.exchanges[0];
  assert.equal(url, 'https://github.com/login/oauth/access_token');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Accept, 'application/json');
  assert.deepEqual(JSON.parse(options.body), {
    code: 'test-code', client_id: 'test-client', client_secret: 'test-secret',
  });
  assert.ok(options.signal instanceof AbortSignal);
});

test('rejects a different IP without consuming or revealing the stored token', async () => {
  const server = createServer();
  await server.request(callback);
  const rejected = await server.request({ state }, { ip: otherIP });
  const unknown = await server.request({ state: 'unknown' }, { ip: otherIP });
  assert.equal(rejected.statusCode, 403);
  assert.deepEqual(rejected.body, unknown.body);
  assert.equal(server.buffers[0].toString(), 'test-token');
  assert.deepEqual((await server.request({ state })).body, { token: 'test-token' });
});

test('ignores spoofed forwarded headers when Vercel supplies the source IP', async () => {
  const server = createServer();
  await server.request(callback, {
    headers: { 'x-forwarded-for': otherIP, 'x-vercel-forwarded-for': otherIP },
  });
  for (const headers of [
    { 'x-forwarded-for': browserIP },
    { 'x-vercel-forwarded-for': browserIP },
    { forwarded: `for=${browserIP}` },
    { 'x-forwarded-for': `${browserIP}, ${otherIP}` },
  ]) {
    assert.equal((await server.request({ state }, { ip: otherIP, headers })).statusCode, 403);
  }
  assert.equal((await server.request({ state })).statusCode, 200);
});

test('fails closed for missing or ambiguous Vercel IPs without using proxy or other headers', async () => {
  const server = createServer();
  for (const ip of [null, '', 'invalid', ' ', `${browserIP}, ${otherIP}`, [browserIP], 'fe80::1%en0']) {
    const options = {
      ip,
      socketAddress: browserIP,
      headers: { 'x-forwarded-for': browserIP, 'x-vercel-forwarded-for': browserIP },
    };
    const response = await server.request(callback, options);
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.body, { error: 'invalid_client_ip' });
    assert.equal((await server.request({ state }, options)).statusCode, 403);
  }
  assert.equal(server.exchanges.length, 0);
});

test('uses the direct socket outside Vercel and ignores user-supplied IP headers', async () => {
  const server = createServer(undefined, { VERCEL: undefined });
  await server.request(callback, { socketAddress: browserIP, ip: otherIP });
  assert.equal((await server.request({ state }, { socketAddress: otherIP })).statusCode, 403);
  assert.equal((await server.request({ state }, { socketAddress: null })).statusCode, 403);
  const response = await server.request({ state }, { socketAddress: browserIP, ip: null });
  assert.deepEqual(response.body, { token: 'test-token' });
});

test('compares the platform-provided IPv6 address directly', async () => {
  const server = createServer();
  const ip = '2001:db8::1';
  await server.request(callback, { ip });
  assert.equal((await server.request({ state }, { ip: '2001:db8::2' })).statusCode, 403);
  assert.equal((await server.request({ state }, { ip })).statusCode, 200);
});

test('expires and wipes tokens after five minutes', async () => {
  const server = createServer();
  await server.request(callback);
  server.advance(5 * 60 * 1000);
  assert.equal((await server.request({ state })).statusCode, 403);
  assert.ok(server.buffers[0].every(byte => byte === 0));
});

test('allows only one concurrent poll to retrieve a token', async () => {
  const server = createServer();
  await server.request(callback);
  const responses = await Promise.all([server.request({ state }), server.request({ state })]);
  assert.deepEqual(responses.map(response => response.statusCode), [200, 403]);
});

test('wipes and removes a token even if sending the response fails', async () => {
  const server = createServer();
  await server.request(callback);
  await assert.rejects(server.request({ state }, { failJSON: true }), /Response failed/);
  assert.ok(server.buffers[0].every(byte => byte === 0));
  assert.equal((await server.request({ state })).statusCode, 403);
});

test('rejects concurrent callbacks and prevents overwriting an existing token', async () => {
  let complete;
  const server = createServer(() => new Promise(resolve => { complete = resolve; }));
  const first = server.request(callback);
  assert.equal((await server.request({ state })).statusCode, 403);
  assert.equal((await server.request(callback, { ip: otherIP })).statusCode, 409);
  complete({ ok: true, json: async () => ({ access_token: 'test-token' }) });
  assert.equal((await first).statusCode, 200);
  assert.equal((await server.request(callback, { ip: otherIP })).statusCode, 409);
  assert.equal(server.exchanges.length, 1);
  assert.deepEqual((await server.request({ state })).body, { token: 'test-token' });
});

test('a stale exchange cannot overwrite or delete a newer token for the same state', async () => {
  let complete;
  let calls = 0;
  const server = createServer(() => {
    if (++calls === 1) return new Promise(resolve => { complete = resolve; });
    return { ok: true, json: async () => ({ access_token: 'new-token' }) };
  });
  const first = server.request(callback);
  server.advance(5 * 60 * 1000);
  assert.equal((await server.request(callback)).statusCode, 200);
  complete({ ok: true, json: async () => ({ access_token: 'old-token' }) });
  assert.equal((await first).statusCode, 502);
  assert.deepEqual((await server.request({ state })).body, { token: 'new-token' });
});

test('limits polling per IP and allows recovery without discarding its token', async () => {
  const server = createServer();
  for (let index = 0; index < 60; index++) {
    assert.equal((await server.request({ state })).statusCode, 403);
  }
  await server.request(callback);
  const limited = await server.request({ state });
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers['retry-after'], '60');
  assert.equal(server.buffers[0].toString(), 'test-token');
  assert.equal((await server.request({ state: 'other' }, { ip: otherIP })).statusCode, 403);
  server.advance(1000);
  assert.equal((await server.request({ state })).headers['retry-after'], '59');
  server.advance(59 * 1000);
  assert.deepEqual((await server.request({ state })).body, { token: 'test-token' });
});

test('bounds polling IP storage and reclaims expired limits', async () => {
  const server = createServer();
  for (let index = 0; index < 1000; index++) {
    await server.request({ state }, { ip: `198.18.${Math.floor(index / 256)}.${index % 256}` });
  }
  assert.equal((await server.request({ state })).statusCode, 429);
  server.advance(60 * 1000);
  assert.equal((await server.request({ state })).statusCode, 403);
});

test('bounds pending token storage and wipes expired entries before making room', async () => {
  const server = createServer();
  for (let index = 0; index < 1000; index++) {
    assert.equal((await server.request({ code: 'test-code', state: `state-${index}` })).statusCode, 200);
  }
  const limited = await server.request(callback);
  assert.equal(limited.statusCode, 503);
  assert.equal(limited.headers['retry-after'], '300');
  assert.equal(server.exchanges.length, 1000);
  server.advance(5 * 60 * 1000);
  assert.equal((await server.request(callback)).statusCode, 200);
  assert.ok(server.buffers.slice(0, -1).every(buffer => buffer.every(byte => byte === 0)));
});

test('handles denied authorization without exchanging a code', async () => {
  const server = createServer();
  const response = await server.request({ state, error: 'access_denied' });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: 'authorization_failed' });
  assert.equal(server.exchanges.length, 0);
});

test('rejects malformed parameters and unsupported methods', async () => {
  const server = createServer();
  for (const query of [
    {},
    { code: 'test-code' },
    { code: ['first', 'second'], state },
    { code: 'test-code', state: [state, state] },
    { code: '', state },
    { code: 'test-code', state: '' },
    { unrelated: 'value' },
  ]) {
    assert.equal((await server.request(query)).statusCode, 400);
  }
  for (const method of ['POST', 'HEAD', 'OPTIONS']) {
    const response = await server.request(callback, { method });
    assert.equal(response.statusCode, 405);
    assert.equal(response.headers.allow, 'GET');
  }
  assert.equal(server.exchanges.length, 0);
});

test('logs exchange failure metadata without OAuth secrets or raw errors', async () => {
  const error = new TypeError('test-code test-token test-secret', {
    cause: Object.assign(new Error('test-code test-token test-secret'), { code: 'ECONNRESET' }),
  });
  const server = createServer(async () => { throw error; });
  assert.equal((await server.request(callback)).statusCode, 502);
  assert.deepEqual(JSON.parse(JSON.stringify(server.logs)), [
    ['GitHub token exchange failed', { name: 'TypeError', code: 'ECONNRESET' }],
  ]);
});

for (const [name, exchange] of [
  ['HTTP errors', async () => ({ ok: false })],
  ['OAuth errors', async () => ({ ok: true, json: async () => ({ error: 'bad_verification_code' }) })],
  ['missing tokens', async () => ({ ok: true, json: async () => ({}) })],
  ['empty tokens', async () => ({ ok: true, json: async () => ({ access_token: '' }) })],
  ['non-string tokens', async () => ({ ok: true, json: async () => ({ access_token: 42 }) })],
  ['malformed JSON', async () => ({ ok: true, json: async () => { throw new Error('Invalid JSON'); } })],
  ['network failures', async () => { throw new Error('Request failed'); }],
]) {
  test(`handles ${name} without storing a token`, async () => {
    const server = createServer(exchange);
    assert.equal((await server.request(callback)).statusCode, 502);
    assert.equal((await server.request({ state })).statusCode, 403);
    assert.equal(server.buffers.length, 0);
    assert.equal(server.exchanges.length, 1);
  });
}
