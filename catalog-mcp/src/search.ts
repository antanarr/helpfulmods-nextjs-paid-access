import type { PresentedMod } from './presentation.js';

const aliases: Readonly<Record<string, readonly string[]>> = {
  booking: ['appointment', 'appointments', 'scheduling', 'reservations', 'calendar booking', 'double booking', 'slot holds'],
  support: ['help desk', 'helpdesk', 'ticketing', 'support tickets', 'customer service'],
  'website-chat': ['chatbot', 'chat bot', 'customer support chatbot', 'website chatbot', 'live chat'],
  'help-center': ['knowledge base', 'faq', 'self service', 'help centre'],
  funnel: ['checkout', 'sales funnel', 'customer payments', 'paid access', 'billing', 'Stripe webhooks', 'webhook retries', 'payment access'],
  teams: ['membership', 'subscriptions', 'seats', 'seat limits', 'team billing', 'team members', 'multi tenancy', 'multi tenant', 'multitenancy', 'multitenant', 'tenant isolation', 'workspaces', 'role based access control', 'RBAC', 'team permissions', 'team invitations'],
  forms: ['questionnaire', 'contact form', 'intake form'],
  notifications: ['notification inbox', 'in app alerts'],
  localization: ['translation', 'translations', 'languages'],
  media: ['image generation', 'images', 'graphics'],
  writing: ['newsletter', 'articles', 'recurring content'],
};
const queryFraming = new Set([
  'a', 'an', 'and', 'another', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'cannot',
  'could', 'do', 'does', 'doing', 'for', 'from', 'get', 'getting', 'have', 'how',
  'i', 'in', 'into', 'is', 'isn', 'it', 'its', 'me', 'my', 'of', 'on', 'or',
  'our', 'should', 't', 'that', 'the', 'their', 'them', 'there', 'these', 'this',
  'to', 'we', 'what', 'when', 'where', 'which', 'why', 'will', 'with', 'would',
  'you', 'your', 'add', 'adding', 'build', 'building', 'connect', 'custom',
  'existing', 'implement', 'implementing', 'integrate', 'need', 'use', 'using',
  'want', 'work', 'working', 'app', 'application', 'users',
]);

const wordForms: Readonly<Record<string, string>> = {
  appointments: 'appointment', accounts: 'account', invites: 'invitation',
  invitations: 'invitation', members: 'member', notifications: 'notification',
  payments: 'payment', permissions: 'permission', roles: 'role', seats: 'seat',
  subscriptions: 'subscription', teams: 'team', tenants: 'tenant', tenancy: 'tenant',
  webhooks: 'webhook', workspaces: 'workspace', authenticate: 'authentication',
  authenticating: 'authentication', limits: 'limit', retries: 'retry', retrying: 'retry',
};

export const normalizeSearchText = (text: string) => text.normalize('NFKD')
  .toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const words = (text: string) => normalizeSearchText(text).split(' ').filter(Boolean)
  .map(word => wordForms[word] ?? word);

/** Remove question framing, while retaining unknown technical terms as constraints. */
export function searchTerms(query: string) {
  return [...new Set(words(query).filter(word => !queryFraming.has(word)))];
}

export function containsSearchTerms(text: string, terms: readonly string[]) {
  const available = new Set(words(text));
  return terms.every(term => available.has(term));
}

/** Rank product names and supported buyer vocabulary above incidental mentions. */
export function searchCatalog(mods: readonly PresentedMod[], query: string, category?: string) {
  const phrase = normalizeSearchText(query), terms = searchTerms(query);
  if (query.trim() && !terms.length) return [];
  return mods.flatMap((mod, index) => {
    if (category && normalizeSearchText(mod.category) !== normalizeSearchText(category)) return [];
    const name = mod.id + ' ' + mod.name;
    const related = (aliases[mod.id] ?? []).join(' ');
    const content = [mod.category, mod.tagline, mod.description, ...mod.forWho,
      ...mod.outcomes, ...(mod.supported ?? [])].join(' ');
    if (!containsSearchTerms([name, related, content].join(' '), terms)) return [];
    const score = terms.reduce((sum, term) => sum
      + (containsSearchTerms(name, [term]) ? 20 : containsSearchTerms(related, [term]) ? 10 : 1), 0)
      + (phrase && [mod.id, mod.name].some(value => normalizeSearchText(value) === phrase) ? 100 : 0)
      + (phrase && (aliases[mod.id] ?? []).some(alias => normalizeSearchText(alias) === phrase) ? 40 : 0);
    return [{ mod, score, index }];
  }).sort((a, b) => b.score - a.score || a.index - b.index).map(row => row.mod);
}
