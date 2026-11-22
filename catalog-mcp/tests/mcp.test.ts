import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { serve } from '@hono/node-server';
import { createCatalogHandler } from '../src/index.js';
import { catalogData } from '../src/catalog.generated.js';
import { validateCatalog } from '../src/catalog.js';

const base = 'https://catalog.test';
const handler = createCatalogHandler({ allowedHosts: ['catalog.test'], allowedOrigins: ['https://buyer.test'] });
function makeClient() {
  const client = new Client({ name: 'catalog-acceptance', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp/catalog`), {
    fetch: async (input, init) => handler(new Request(input, init)),
  });
  return { client, transport };
}
function request(method: string, options: { url?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Request(options.url ?? `${base}/mcp/catalog`, { method, headers: options.headers, ...(options.body === undefined ? {} : { body: options.body }) });
}
function payload(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && 'structuredContent' in value);
  return value.structuredContent as Record<string, unknown>;
}

test('real SDK client negotiates HTTP, discovers strict readonly tools and reads every resource', async () => {
  const { client, transport } = makeClient();
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.name, 'helpfulmods-public-catalog');
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name), ['search_catalog', 'prepare_cart_link', 'get_mod_details', 'get_setup_overview', 'get_compatibility_guidance']);
    for (const tool of tools) {
      assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
      assert.equal(tool.inputSchema.additionalProperties, false);
    }
    const search = payload(await client.callTool({ name: 'search_catalog', arguments: {} }));
    assert.equal(search.total, 25);
    assert.equal((search.mods as unknown[]).length, 16);
    const complete = payload(await client.callTool({ name: 'search_catalog', arguments: { limit: 25 } }));
    assert.equal((complete.mods as unknown[]).length, 25);
    const filtered = payload(await client.callTool({ name: 'search_catalog', arguments: { query: 'writing', category: 'Content', limit: 1 } }));
    assert.equal((filtered.mods as unknown[]).length, 1);
    const detail = payload(await client.callTool({ name: 'get_mod_details', arguments: { id: 'writing' } }));
    assert.equal((detail.mod as { name: string }).name, 'Recurring Writing');
    assert.equal((detail.mod as { version: string }).version, '1.1.2');
    assert.equal((detail.mod as { status: string }).status, 'preview');
    assert.match((detail.policy as { purchaseAvailability: string }).purchaseAvailability,/customer account checks current availability/);
    const current = validateCatalog(catalogData);
    for (const id of ['funnel', 'media', 'onboarding', 'referrals', 'reporting', 'testimonials']) {
      const details = payload(await client.callTool({ name: 'get_mod_details', arguments: { id } }));
      assert.equal((details.mod as { developmentHistory: string }).developmentHistory, current[id]!.developmentHistory);
      const resource = await client.readResource({ uri: `helpfulmods://mods/${id}` });
      assert.equal(JSON.parse(String(resource.contents[0]!.text)).mod.developmentHistory, current[id]!.developmentHistory);
    }
    const chat = payload(await client.callTool({ name: 'get_mod_details', arguments: { id: 'website-chat' } }));
    assert.equal((chat.mod as { version: string }).version,'0.1.10');
    assert.deepEqual((chat.mod as { runtime: unknown }).runtime,{node:'24+',database:'SQLite',processScope:'one process per database'});
    const locale = payload(await client.callTool({ name: 'get_mod_details', arguments: { id: 'localization' } }));
    assert.equal((locale.mod as { version: string }).version,'1.1.2');
    const setup = payload(await client.callTool({ name: 'get_setup_overview', arguments: { id: 'social' } }));
    assert.ok((setup.setupEnv as string[]).includes('HM_AYRSHARE_API_KEY'));
    assert.equal((setup.buyerResources as { path: string }[])[1]?.path, 'setup/SKILL.md');
    const compatibility = payload(await client.callTool({ name: 'get_compatibility_guidance', arguments: { ids: ['writing', 'social'], environment: 'Existing Next.js app and PostgreSQL' } }));
    assert.match(String(compatibility.assessment), /Not verified/);
    assert.equal((compatibility.mods as unknown[]).length, 2);
    const { resources } = await client.listResources();
    assert.equal(resources.length, 27);
    for (const resource of resources) {
      const read = await client.readResource({ uri: resource.uri });
      const content = read.contents[0];
      assert.ok(content && 'text' in content);
      const json = JSON.parse(content.text);
      assert.ok(json.mod || json.mods || json.policy);
      assert.doesNotMatch(content.text, /https?:\/\/|\/account|resource-grant|download-token|Bearer /i);
    }
    await assert.rejects(client.readResource({ uri: 'file:///etc/passwd' }));
    await assert.rejects(client.readResource({ uri: 'helpfulmods://mods/review-responder' }));
    for (const id of ['waitlist','testimonials','notifications','feature-flags','help-center','blog','forms','agent-transactions']) {
      assert.notEqual((await client.callTool({ name: 'get_mod_details', arguments: { id } })).isError, true);
      assert.notEqual((await client.callTool({ name: 'get_setup_overview', arguments: { id } })).isError, true);
    }
    for (const id of ['constructor', 'prototype', 'review-responder', 'not-a-mod']) {
      assert.equal((await client.callTool({ name: 'get_mod_details', arguments: { id } })).isError, true);
      assert.equal((await client.callTool({ name: 'get_setup_overview', arguments: { id } })).isError, true);
    }
    assert.notEqual((await client.callTool({ name: 'get_compatibility_guidance', arguments: { ids: ['writing', 'forms'], environment: 'Node.js' } })).isError, true);
    for (const args of [{ query: 'a'.repeat(241) }, { limit: 0 }, { limit: 51 }, { limit: 2.5 }, { unexpected: true }]) {
      assert.equal((await client.callTool({ name: 'search_catalog', arguments: args })).isError, true);
    }
    assert.equal((await client.callTool({ name: 'get_mod_details', arguments: { id: '../writing' } })).isError, true);
    assert.equal((await client.callTool({ name: 'get_compatibility_guidance', arguments: { ids: Array(9).fill('writing'), environment: 'Node.js' } })).isError, true);
  } finally { await client.close(); }
});

test('HTTP enforces exact host, origin, route, methods, message size and CORS boundaries', async () => {
  assert.throws(() => createCatalogHandler({ allowedHosts: [], allowedOrigins: [] }));
  assert.throws(() => createCatalogHandler({ allowedHosts: ['catalog.test/path'], allowedOrigins: [] }));
  assert.throws(() => createCatalogHandler({ allowedHosts: ['catalog.test'], allowedOrigins: ['*'] }));
  assert.equal((await handler(request('POST', { url: 'https://evil.test/mcp/catalog' }))).status, 403);
  assert.equal((await handler(request('POST', { headers: { host: 'evil.test' } }))).status, 403);
  for (const origin of ['https://evil.test', 'null', 'https://buyer.test.evil.test', 'https://buyer.test/']) assert.equal((await handler(request('POST', { headers: { origin } }))).status, 403);
  assert.equal((await handler(request('POST', { url: `${base}/mcp` }))).status, 404);
  assert.equal((await handler(request('POST', { url: `${base}/mcp/catalog?token=secret` }))).status, 404);
  for (const method of ['GET', 'DELETE', 'PUT']) assert.equal((await handler(request(method))).status, 405);
  const preflight = await handler(request('OPTIONS', { headers: { origin: 'https://buyer.test' } }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://buyer.test');
  assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
  assert.equal((await handler(request('OPTIONS'))).headers.get('access-control-allow-origin'), null);
  const headers = { accept: 'application/json, text/event-stream', 'content-type': 'application/json' };
  assert.equal((await handler(request('POST', { headers, body: 'x'.repeat(16385) }))).status, 413);
  assert.equal((await handler(request('POST', { headers, body: '{broken' }))).status, 400);
  const messages = [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }];
  const response = await handler(request('POST', { headers: { ...headers, origin: 'https://buyer.test' }, body: JSON.stringify(messages[0]) }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('mcp-session-id'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://buyer.test');
});

test('independent concurrent SDK clients use fresh stateless server instances', async () => {
  await Promise.all(Array.from({ length: 6 }, async () => {
    const { client, transport } = makeClient();
    try { await client.connect(transport); assert.equal((await client.listTools()).tools.length, 5); } finally { await client.close(); }
  }));
});

test('HTTP rejects all batches promptly, including request/cancellation combinations', { timeout: 1500 }, async () => {
  const headers = { accept: 'application/json, text/event-stream', 'content-type': 'application/json' };
  const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
  const cancelled = { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } };
  const tool = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_catalog', arguments: {} } };
  for (const batch of [[], [ping], [ping, ping], [ping, cancelled], [tool, cancelled], [ping, { ...ping, id: 2 }]]) {
    const response = await handler(request('POST', { headers, body: JSON.stringify(batch) }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, -32600);
  }
  const response = await handler(request('POST', { headers, body: JSON.stringify(cancelled) }));
  assert.equal(response.status, 202);
  const followup = await handler(request('POST', { headers, body: JSON.stringify(ping) }));
  assert.equal(followup.status, 200);
  assert.equal((await followup.json()).id, 1);
});

test('HTTP aborts stalled body reads and returns a bounded cancellation response', { timeout: 1500 }, async () => {
  const controller = new AbortController();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const pending = handler(new Request(`${base}/mcp/catalog`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: controller.signal,
    // Node requires duplex for a streaming request body; Fetch runtimes ignore it.
    ...{ duplex: 'half' },
  }));
  controller.abort();
  const response = await pending;
  assert.equal(response.status, 499);
  assert.equal(cancelled, true);
  assert.match((await response.json()).error.message, /cancelled/);
  let preAbortedCancelled = false;
  const preAbortedBody = new ReadableStream<Uint8Array>({ cancel() { preAbortedCancelled = true; } });
  const preAbortedRequest = new Request(`${base}/mcp/catalog`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: preAbortedBody, signal: AbortSignal.abort(), ...{ duplex: 'half' },
  });
  const alreadyAborted = await handler(preAbortedRequest);
  assert.equal(alreadyAborted.status, 499);
  assert.equal(preAbortedCancelled, true);
  assert.equal(preAbortedRequest.body?.locked, false);
});

test('HTTP reports request-body stream failures without exposing underlying errors', { timeout: 1500 }, async () => {
  let fail: (reason: Error) => void;
  const body = new ReadableStream<Uint8Array>({ start(controller) { fail = reason => controller.error(reason); } });
  const pending = handler(new Request(`${base}/mcp/catalog`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body, ...{ duplex: 'half' },
  }));
  fail(new Error('synthetic network failure with private detail'));
  const response = await pending;
  assert.equal(response.status, 400);
  assert.deepEqual((await response.json()).error, { code: -32700, message: 'Unable to read request body.' });
});

test('HTTP deadline releases a stalled request body even without client cancellation', { timeout: 7000 }, async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const response = await handler(new Request(`${base}/mcp/catalog`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body, ...{ duplex: 'half' },
  }));
  assert.equal(response.status, 408);
  assert.equal(cancelled, true);
  assert.match((await response.json()).error.message, /timed out/);
});

test('HTTP closes its SDK transport when an in-flight SDK response is interrupted', { timeout: 1500 }, async context => {
  let entered: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let closed = 0;
  const originalClose = WebStandardStreamableHTTPServerTransport.prototype.close;
  context.mock.method(WebStandardStreamableHTTPServerTransport.prototype, 'handleRequest', () => {
    entered();
    return new Promise<Response>(() => {});
  });
  context.mock.method(WebStandardStreamableHTTPServerTransport.prototype, 'close', async function (this: WebStandardStreamableHTTPServerTransport) {
    closed += 1;
    await originalClose.call(this);
  });
  const controller = new AbortController();
  const pending = handler(new Request(`${base}/mcp/catalog`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }), signal: controller.signal,
  }));
  await started;
  controller.abort();
  assert.equal((await pending).status, 499);
  assert.equal(closed, 1);
});

test('SDK client works over a real loopback HTTP socket', async () => {
  let localHandler: ReturnType<typeof createCatalogHandler>;
  const http = serve({ hostname: '127.0.0.1', port: 0, fetch: request => localHandler(request) });
  await new Promise<void>(resolve => http.once('listening', resolve));
  const address = http.address();
  assert.ok(address && typeof address !== 'string');
  const host = `127.0.0.1:${address.port}`;
  localHandler = createCatalogHandler({ allowedHosts: [host], allowedOrigins: [] });
  const client = new Client({ name: 'socket-test', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://${host}/mcp/catalog`)));
    assert.equal(payload(await client.callTool({ name: 'search_catalog', arguments: {} })).total, 25);
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
  }
});

test('built stdio adapter supports the real SDK client', async () => {
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/stdio.js'], stderr: 'pipe' });
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 5);
    assert.equal((await client.readResource({ uri: 'helpfulmods://policy' })).contents.length, 1);
  } finally { await client.close(); }
});

test('Website Chat public setup and resource facts match its standalone source without granting hosted access', async () => {
  const { client, transport } = makeClient();
  try {
    await client.connect(transport);
    const details = payload(await client.callTool({ name: 'get_mod_details', arguments: { id: 'website-chat' } }));
    const mod = details.mod as {id:string;version:string;price:number;boundary:string};
    assert.equal(mod.id, 'website-chat'); assert.equal(mod.version, '0.1.10'); assert.equal(mod.price, 99);
    assert.equal((details.policy as {priceBasis:string}).priceBasis, 'before applicable tax'); assert.match(mod.boundary, /Node\.js 24.*SQLite/);
    const setup = payload(await client.callTool({ name: 'get_setup_overview', arguments: { id: 'website-chat' } }));
    assert.deepEqual((setup.buyerResources as {path:string}[]).map(value=>value.path), ['setup/SKILL.md','setup/AGENT_HELP.md','setup/error-reference.json','setup/integration.json','docs/INTEGRATION.md','docs/DEPENDENCIES.md']);
    assert.match(String(setup.resourceLocation), /extracted purchased package/);
    assert.match(String(setup.resourceLocation), /cannot read their files or grant access/);
    const read = await client.readResource({ uri:'helpfulmods://mods/website-chat' });
    const content=read.contents[0];assert(content&&'text' in content);
    assert.doesNotMatch(content.text,/\/resources\/|resource-grant|download-token|Bearer /i);
    await assert.rejects(client.readResource({uri:'helpfulmods://mods/website-chat/setup/SKILL.md'}));
    assert.equal((details.policy as {priceBasis:string}).priceBasis,'before applicable tax');
  } finally { await client.close(); }
});
