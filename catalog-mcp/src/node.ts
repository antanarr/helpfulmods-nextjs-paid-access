import { serve } from '@hono/node-server';
import { createCatalogHandler } from './index.js';

const port = Number(process.env.PORT ?? 4397);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
const origin = `http://127.0.0.1:${port}`;
const handler = createCatalogHandler({ allowedHosts: [`127.0.0.1:${port}`], allowedOrigins: [origin] });
const server = serve({ fetch: handler, port, hostname: '127.0.0.1' });
console.error(`HelpfulMods public catalog listening at ${origin}/mcp/catalog`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close());
