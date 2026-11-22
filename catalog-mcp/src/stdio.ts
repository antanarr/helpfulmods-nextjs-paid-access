import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createCatalogServer } from './server.js';
await createCatalogServer().connect(new StdioServerTransport());
