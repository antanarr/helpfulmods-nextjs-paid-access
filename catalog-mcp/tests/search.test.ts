import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { catalogData } from '../src/catalog.generated.js';
import { validateCatalog } from '../src/catalog.js';
import { createCatalogHandler } from '../src/index.js';
import { FoundationPublicProductSchema, foundationSearchMatches } from '../src/foundation.js';
import { searchCatalog } from '../src/search.js';

const mods = Object.values(validateCatalog(catalogData));
const ids = (query: string, category?: string) => searchCatalog(mods, query, category).map(mod => mod.id);
const archive = { key: 'fixture.tar.gz', sha256: 'a'.repeat(64), size: 100 };
const foundation = FoundationPublicProductSchema.parse({
  id: 'foundation-kit', productKind: 'foundation-kit', purchaseMode: 'human_cart',
  name: 'Foundation Kit', description: 'Connected accounts, team workspaces and billing.',
  version: '1.2.2', price: 199, returningCustomerPrice: 199, currency: 'USD',
  priceBasis: 'before applicable tax', purchaseAvailable: true,
  url: 'https://helpfulmods.com/foundation/', compositionSha256: 'b'.repeat(64),
  composition: {
    formatVersion: 1, productId: 'foundation-kit', version: '1.2.2', licenseVersion: '1.0.0', archive,
    terms: { licensedApplications: 1, setupSupportDays: 30, fixesIncludedMonths: 12 },
    components: ['funnel', 'teams', 'onboarding', 'notifications', 'support'].map(productId => ({
      productId, version: '1.0.0', licenseVersion: '1.0.0', archive,
    })),
  },
  setup: {
    requirements: ['Node.js 24 and PostgreSQL 17.', 'Firebase Authentication.'],
    workflow: ['Configure your provider accounts.'], verification: ['Verify workspace access.'],
    buyerResources: [{ path: 'README.md', purpose: 'Setup instructions.' }],
  },
});

test('buyer questions find billing and tenancy without requiring our product names', () => {
  for (const query of ['multi-tenancy', 'multi tenancy', 'multi-tenant', 'multitenant',
    'tenant isolation', 'How do I add tenant isolation to my existing app?',
    'RBAC', 'role-based access control', 'team permissions', 'workspace',
    'Why can’t I add another team member?', 'seat limits']) {
    assert.equal(ids(query)[0], 'teams', query);
  }
  for (const query of ['add billing to my custom app', 'How do I add billing to my custom app?',
    'I need Stripe webhooks working in my app', 'Stripe webhook', 'webhook retries']) {
    assert.equal(ids(query)[0], 'funnel', query);
  }
});

test('existing product names and buyer aliases keep their leading result', () => {
  for (const mod of mods) assert.equal(ids(mod.name)[0], mod.id, mod.name);
  for (const [query, expected] of [['appointments', 'booking'], ['help desk', 'support'],
    ['customer support chatbot', 'website-chat'], ['knowledge base', 'help-center'],
    ['notification inbox', 'notifications']]) {
    assert.equal(ids(query!)[0], expected, query);
  }
});

test('unknown technical constraints and empty questions do not become broad recommendations', () => {
  for (const query of ['...', 'How do I add it?', 'billing coconutxyz',
    "Why can't I get XYZ to authenticate?", 'no-matching-customer-workflow-xyz']) {
    assert.deepEqual(ids(query), [], query);
    assert.equal(foundationSearchMatches(foundation, query), false, query);
  }
  assert.deepEqual(ids('chatgpt'), []);
  assert.deepEqual(ids('authenticate'), []);
});

test('search ignores schema keys, setup variable names and historical provenance', () => {
  const changed = structuredClone(mods[0]!);
  changed.developmentHistory = 'historicalneedle';
  changed.setupEnv = ['SECRET_SETTING_NEEDLE'];
  changed.limitations = ['Does not implement unsupportedneedle.'];
  for (const query of ['historicalneedle', 'secret setting needle', 'unsupportedneedle', 'developmentHistory']) {
    assert.deepEqual(searchCatalog([changed], query), [], query);
  }
});

test('category filtering, blank catalog discovery and hidden-product input stay bounded', () => {
  assert.equal(ids('').length, 25);
  assert.equal(ids('   ').length, 25);
  assert.deepEqual(ids('multi-tenancy', 'Content'), []);
  assert.equal(ids('writing', ' content ')[0], 'writing');
  assert.deepEqual(searchCatalog(mods.filter(mod => mod.id !== 'teams'), 'tenant isolation'), []);
});

test('Foundation uses the same buyer questions and authentication vocabulary', () => {
  for (const query of ['Foundation Kit', 'foundation-kit', 'multi-tenancy', 'tenant isolation',
    'How do I add billing to my custom app?', "Why can't I authenticate with Firebase?",
    'login', 'Google login', 'GitHub OAuth', 'sign in', 'accounts', 'workspaces', 'user authentication', 'SaaS auth']) {
    assert.equal(foundationSearchMatches(foundation, query), true, query);
  }
  assert.equal(foundationSearchMatches(foundation, ''), true);
  assert.equal(foundationSearchMatches(foundation, 'billing', ' APPLICATION '), true);
  assert.equal(foundationSearchMatches(foundation, 'billing', 'Content'), false);
});

test('anonymous SDK returns relevant mods and a separate Foundation without changing commerce facts', async () => {
  const handler = createCatalogHandler({
    allowedHosts: ['catalog.test'], allowedOrigins: [], foundationProduct: async () => foundation,
  });
  const client = new Client({ name: 'buyer-question-regression', version: '1' });
  const result = z.object({
    mods: z.array(z.object({ id: z.string(), price: z.literal(99) })),
    kits: z.array(FoundationPublicProductSchema), total: z.number(),
  });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL('https://catalog.test/mcp/catalog'), {
      fetch: async (input, init) => handler(new Request(input, init)),
    }));
    for (const [query, expected] of [['multi-tenancy', 'teams'], ['tenant isolation', 'teams'],
      ['How do I add billing to my custom app?', 'funnel']]) {
      const response = await client.callTool({ name: 'search_catalog', arguments: { query } });
      const found = result.parse(response.structuredContent);
      assert.equal(found.mods[0]?.id, expected);
      assert.equal(found.kits[0]?.id, 'foundation-kit');
      assert.equal(found.kits[0]?.price, 199);
    }
    const all = result.parse((await client.callTool({ name: 'search_catalog', arguments: { limit: 50 } })).structuredContent);
    assert.equal(all.total, 25);
    assert.equal(all.mods.length, 25);
    assert.equal(all.kits.length, 1);
    const auth = result.parse((await client.callTool({ name: 'search_catalog', arguments: { query: 'authenticate with Firebase' } })).structuredContent);
    assert.equal(auth.mods.length, 0);
    assert.equal(auth.kits[0]?.id, 'foundation-kit');
  } finally {
    await client.close();
  }
});
