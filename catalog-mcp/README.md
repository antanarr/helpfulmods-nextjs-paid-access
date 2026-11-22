# Helpful Mods catalog MCP

This directory contains the public catalog MCP server and HTTP handler used by [Helpful Mods](https://helpfulmods.com/). Its five tools search source products, show product and setup information, compare published requirements with an application stack, and prepare a cart link for the buyer to review.

The standalone app runs from a bundled public catalog snapshot. The hosted endpoint also receives current availability, product presentation and Foundation Kit information from the Helpful Mods application through callbacks. Those host services are separate from this component. For the current hosted catalog, connect an MCP client to:

```text
https://account.helpfulmods.com/api/mcp/catalog
```

## Run locally

Requires Node.js 22.13 or later.

```sh
npm ci
npm run verify
npm start
```

`npm start` serves MCP over stdin/stdout. Configure your client to run `node` with the absolute path to `dist/stdio.js`.

For local HTTP use:

```sh
npm run serve
```

The HTTP adapter listens at `http://127.0.0.1:4397/mcp/catalog`. Set `PORT` to choose another port and stop it with Ctrl-C. Neither local adapter needs credentials.

## Tools and resources

| Tool | Purpose |
| --- | --- |
| `search_catalog` | Find products by feature or category. |
| `get_mod_details` | Read a product's public record. |
| `get_setup_overview` | Read prerequisites, setup steps and verification guidance. |
| `get_compatibility_guidance` | Compare published mod support with the stack supplied by the caller. |
| `prepare_cart_link` | Return a cart URL for selected products. |

The server also exposes public catalog, purchase policy and product-detail resources. Cart links let buyers review their selection; creating a link does not make a payment or grant source access. Compatibility guidance reports published requirements and does not inspect the caller's application.

## HTTP integration

`createCatalogHandler` accepts Web Standard `Request` objects and returns `Promise<Response>`:

```ts
import { createCatalogHandler } from './dist/index.js';

const handleCatalog = createCatalogHandler({
  allowedHosts: ['catalog.example.com'],
  allowedOrigins: ['https://catalog.example.com'],
  path: '/mcp/catalog',
});

const response = await handleCatalog(request);
```

Use your application's real host and approved browser origins. The handler checks the host and origin, bounds requests to 16 KiB, rejects JSON-RPC batches, and closes each request's MCP server after its response. It uses the official TypeScript MCP SDK's Streamable HTTP transport.

The optional `catalogPresentation` callback supplies public visibility, display text and purchase availability. The optional `foundationProduct` callback supplies a Foundation Kit record validated by `FoundationPublicProductSchema`. Their types and the complete handler are in `src/index.ts`; no database or commerce implementation is required to run the bundled snapshot.

`src/catalog.generated.ts` is the retained public snapshot, with its source digest. This export does not include the original project's catalog importer or private release records. Update that snapshot deliberately when maintaining a separate installation.

## Verification

`npm run verify` type-checks, builds and runs the included tests. They exercise real MCP SDK clients, HTTP and stdio adapters, all five tools, public resources, search, visibility and purchase holds, host/origin checks, request limits, cancellation and timeout cleanup.

## License

The MIT license in this directory applies to this catalog component. The product records describe separately licensed source packages sold by Helpful Mods. Their package source, accounts, checkout, purchased downloads and private operating configuration are not included here.
