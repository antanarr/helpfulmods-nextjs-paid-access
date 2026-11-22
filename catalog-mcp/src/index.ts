import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createCatalogServer } from "./server.js";
import { catalogData } from "./catalog.generated.js";
import type { FoundationPublicProduct } from "./foundation.js";
import { validateCatalog } from "./catalog.js";
import type { CatalogPresentationReader } from "./presentation.js";
export type {
  CatalogPresentation,
  CatalogPresentationReader,
} from "./presentation.js";
export { createCatalogServer } from "./server.js";
export { sourceSha256 } from "./catalog.generated.js";

const maxBodyBytes = 16 * 1024;
const requestTimeoutMs = 5000;

class RequestFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

async function readMessage(
  request: Request,
  signal: AbortSignal,
): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) {
    signal.throwIfAborted();
    throw new RequestFailure(400, -32700, "Invalid JSON.");
  }
  const cancel = () => {
    // A disconnected stream may already be errored; cancellation remains best-effort cleanup.
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    if (signal.aborted) cancel();
    signal.throwIfAborted();
    if (Number(request.headers.get("content-length")) > maxBodyBytes) {
      cancel();
      throw new RequestFailure(413, -32000, "Request body exceeds 16 KiB.");
    }
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        signal.throwIfAborted();
        throw new RequestFailure(400, -32700, "Unable to read request body.");
      }
      signal.throwIfAborted();
      const { done, value } = chunk;
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBodyBytes) {
        cancel();
        throw new RequestFailure(413, -32000, "Request body exceeds 16 KiB.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    throw new RequestFailure(400, -32700, "Invalid JSON.");
  }
  if (Array.isArray(message))
    throw new RequestFailure(
      400,
      -32600,
      "JSON-RPC batches are not supported. Send one message per request.",
    );
  return message;
}

export interface CatalogHandlerOptions {
  /** Exact public origins (scheme, host, optional port). No wildcards. */
  allowedOrigins: readonly string[];
  /** Exact trusted URL/Host authorities, including port when applicable. */
  allowedHosts: readonly string[];
  path?: string;
  /** Trusted owner-store callback; selects only display/visibility before SDK registration. */
  catalogPresentation?: CatalogPresentationReader;
  /** Separate reviewed application product; never changes the individual-mod schema. */
  foundationProduct?: () => Promise<FoundationPublicProduct | null>;
}

export function createCatalogHandler(
  options: CatalogHandlerOptions,
): (request: Request) => Promise<Response> {
  const path = options.path ?? "/mcp/catalog";
  const hosts = new Set(options.allowedHosts.map((host) => host.toLowerCase()));
  const origins = new Set(options.allowedOrigins);
  if (
    !hosts.size ||
    !path.startsWith("/") ||
    path.includes("?") ||
    path.includes("#")
  )
    throw new Error(
      "Configure exact allowedHosts and an absolute endpoint path.",
    );
  for (const host of hosts) {
    const url = new URL(`https://${host}`);
    if (
      host.includes("*") ||
      url.host !== host ||
      url.pathname !== "/" ||
      url.username ||
      url.password
    )
      throw new Error("Invalid allowed host.");
  }
  for (const origin of origins) {
    const url = new URL(origin);
    if (!["https:", "http:"].includes(url.protocol) || url.origin !== origin)
      throw new Error("Invalid allowed origin.");
  }
  return async (request) => {
    const url = new URL(request.url);
    const host = request.headers.get("host");
    if (
      !hosts.has(url.host.toLowerCase()) ||
      (host !== null &&
        (!hosts.has(host.toLowerCase()) ||
          host.toLowerCase() !== url.host.toLowerCase()))
    )
      return new Response("Invalid host", { status: 403 });
    const origin = request.headers.get("origin");
    if (origin !== null && !origins.has(origin))
      return new Response("Invalid origin", { status: 403 });
    if (url.pathname !== path || url.search)
      return new Response("Not found", { status: 404 });
    const headers = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
    });
    if (origin !== null) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Access-Control-Expose-Headers", "MCP-Protocol-Version");
    }
    if (request.method === "OPTIONS") {
      headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, MCP-Protocol-Version",
      );
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") {
      headers.set("Allow", "POST, OPTIONS");
      return new Response("Method not allowed", { status: 405, headers });
    }
    const controller = new AbortController();
    const abortFromClient = () =>
      controller.abort(new RequestFailure(499, -32000, "Request cancelled."));
    let rejectInterrupted: (reason: unknown) => void;
    const interrupted = new Promise<never>((_, reject) => {
      rejectInterrupted = reject;
    });
    const onInterrupted = () => rejectInterrupted(controller.signal.reason);
    controller.signal.addEventListener("abort", onInterrupted, { once: true });
    request.signal.addEventListener("abort", abortFromClient, { once: true });
    const timer = setTimeout(
      () =>
        controller.abort(new RequestFailure(408, -32000, "Request timed out.")),
      requestTimeoutMs,
    );
    if (request.signal.aborted) abortFromClient();
    let server: ReturnType<typeof createCatalogServer> | undefined;
    try {
      // Reject arrays before constructing an SDK server: batch cancellation can leave SDK JSON responses pending.
      const message = await Promise.race([
        readMessage(request, controller.signal),
        interrupted,
      ]);
      controller.signal.throwIfAborted();
      const method =
        message && typeof message === "object" && "method" in message
          ? message.method
          : undefined;
      // Only product queries need live visibility and purchase state.
      const readsCatalog =
        method === "tools/call" ||
        method === "resources/list" ||
        method === "resources/read";
      const [presentation, foundationProduct] = readsCatalog
        ? await Promise.race([
            Promise.all([
              options.catalogPresentation?.(
                Object.keys(validateCatalog(catalogData)),
              ),
              options.foundationProduct?.(),
            ]),
            interrupted,
          ])
        : [undefined, undefined];
      controller.signal.throwIfAborted();
      server = createCatalogServer({
        ...(presentation ? { presentation } : {}),
        ...(foundationProduct !== undefined ? { foundationProduct } : {}),
        canListFoundation: Boolean(options.foundationProduct),
      });
      const transport = new WebStandardStreamableHTTPServerTransport({
        enableJsonResponse: true,
      });
      await Promise.race([server.connect(transport), interrupted]);
      const response = await Promise.race([
        transport.handleRequest(request, { parsedBody: message }),
        interrupted,
      ]);
      response.headers.forEach((value, key) => headers.set(key, value));
      // JSON mode produces a complete response; no SSE connection outlives this request.
      const body = await Promise.race([response.arrayBuffer(), interrupted]);
      return new Response(body, { status: response.status, headers });
    } catch (error) {
      if (!(error instanceof RequestFailure)) throw error;
      headers.set("Content-Type", "application/json");
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: error.code, message: error.message },
        }),
        { status: error.status, headers },
      );
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", abortFromClient);
      controller.signal.removeEventListener("abort", onInterrupted);
      await server?.close();
    }
  };
}
