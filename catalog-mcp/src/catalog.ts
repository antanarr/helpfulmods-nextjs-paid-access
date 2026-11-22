// INACTIVE companion schema: preserve supplied source-readiness statuses without implying purchase availability.
import { z } from 'zod';

const text = z.string().min(1).max(6000);
const lines = z.array(text).min(1).max(40);
export const modSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
  name: text, category: text, price: z.number().nonnegative().max(100000),
  priceBasis: z.literal('before applicable tax').optional(),
  status: z.enum(['available', 'candidate', 'preview']), version: z.string().regex(/^\d+\.\d+\.\d+$/),
  tagline: text, description: text, developmentHistory: text.optional(), forWho: lines, outcomes: lines,
  workflow: lines, questions: lines, verification: lines, boundary: text,
  supported: lines.optional(), limitations: lines.optional(), requires: lines.optional(),
  setupEnv: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,100}$/)).max(40).optional(),
  runtime: z.strictObject({ node: z.literal('24+'), database: z.literal('SQLite'), processScope: z.literal('one process per database') }).optional(),
});
export type Mod = z.infer<typeof modSchema>;
export type Catalog = Readonly<Record<string, Mod>>;

export function validateCatalog(value: unknown): Catalog {
  const catalog = z.record(z.string(), modSchema).parse(value);
  const entries = Object.entries(catalog);
  if (entries.length < 1 || entries.length > 200) throw new Error('Catalog must contain 1-200 accepted mods.');
  for (const [key, mod] of entries) {
    if (key !== mod.id) throw new Error(`Catalog key does not match mod id: ${key}`);
    if (mod.runtime && mod.id !== 'website-chat') throw new Error('The reviewed runtime exception belongs only to Website Chat.');
    // Public catalog copy has no links. Reject link injection rather than forwarding arbitrary destinations.
    if (/https?:\/\/|javascript:|file:\/\/|data:/i.test(JSON.stringify(mod))) {
      throw new Error(`Catalog links require an explicit reviewed allowlist: ${key}`);
    }
  }
  // Unknown IDs such as "constructor" must not resolve inherited object properties.
  Object.setPrototypeOf(catalog, null);
  return Object.freeze(catalog);
}

/** Accept only the canonical JSON assignment, never evaluate JavaScript. */
export function parseCatalogSource(source: string): Catalog {
  if (new TextEncoder().encode(source).length > 1024 * 1024) throw new Error('Catalog source exceeds 1 MiB.');
  const match = /^(?:\s*['"]use strict['"];\s*)?\s*window\.HelpfulModsCatalog\s*=\s*([\s\S]*?)\s*;?\s*$/.exec(source);
  if (!match?.[1]) throw new Error('Expected a single window.HelpfulModsCatalog JSON assignment.');
  return validateCatalog(JSON.parse(match[1]));
}

export const policy = Object.freeze({
  currency: 'USD', firstModPrice: 99, additionalModPrice: 75,
  priceBasis: 'before applicable tax',
  additionalPricingCondition: 'The first mod is $99; each additional different mod in the same initial cart is $75. Checkout also verifies $75 pricing for eligible previous customers.',
  payment: 'One-time purchase. No monthly payment or automatic renewal.',
  included: 'Source, setup prompts, support resources, at least 12 months of bug and security fixes for the purchased version, and 30 days of setup help.',
  majorUpgrades: 'Future major upgrades are optional separate purchases.',
  separateCosts: 'Hosting and connected services are separate.',
  purchaseAvailability: 'The customer account checks current availability, pricing and eligibility. This catalog provides product information and grants no ownership or access.',
});

export const buyerResources = Object.freeze([
  { path: 'README.md', purpose: 'Package overview and local prerequisites.' },
  { path: 'setup/SKILL.md', purpose: 'Source-matched setup instructions for your agent.' },
  { path: 'setup/AGENT_HELP.md', purpose: 'Integration and troubleshooting guidance.' },
  { path: 'setup/error-reference.json', purpose: 'Structured error reference.' },
]);

export function setupOverview(mod: Mod) {
  return {
    id: mod.id, version: mod.version, workflow: mod.workflow, questions: mod.questions,
    verification: mod.verification, boundary: mod.boundary,
    setupEnv: mod.setupEnv ?? [],
    setupEnvNote: mod.setupEnv ? 'Publicly listed variable names only; consult the purchased package for full requirements.' : 'Environment variables are not listed in the public catalog; consult the purchased package.',
    buyerResources: mod.id === 'website-chat' ? [
      { path: 'setup/SKILL.md', purpose: 'Source-matched setup instructions for your agent.' },
      { path: 'setup/AGENT_HELP.md', purpose: 'Integration and troubleshooting guidance.' },
      { path: 'setup/error-reference.json', purpose: 'Structured error reference.' },
      { path: 'setup/integration.json', purpose: 'Machine-readable runtime and integration contract.' },
      { path: 'docs/INTEGRATION.md', purpose: 'Website and agent integration guidance.' },
      { path: 'docs/DEPENDENCIES.md', purpose: 'Required and optional dependencies.' },
    ] : buyerResources,
    requirements: mod.requires ?? [],
    resourceLocation: 'These paths are relative to your extracted purchased package. Ask the buyer for its location; this server cannot read their files or grant access.',
  };
}
