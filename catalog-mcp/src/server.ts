import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { catalogData, sourceSha256 } from "./catalog.generated.js";
import { policy, setupOverview, validateCatalog } from "./catalog.js";
import {
  applyCatalogPresentation,
  type CatalogPresentation,
  type PresentedMod,
} from "./presentation.js";
import { searchCatalog } from "./search.js";
import {
  FoundationPublicProductSchema,
  foundationSearchMatches,
  foundationSetup,
  type FoundationPublicProduct,
} from "./foundation.js";

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const id = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
const publicProductId = id.describe(
  'Lowercase product ID from search_catalog, such as "funnel" or "foundation-kit" when listed.',
);
const standaloneModId = id.describe(
  'Lowercase standalone mod ID from search_catalog, such as "funnel".',
);
const result = (data: Record<string, unknown>): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  structuredContent: data,
});
const toolError = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});
const summary = (mod: PresentedMod) => ({
  id: mod.id,
  name: mod.name,
  category: mod.category,
  version: mod.version,
  status: mod.status,
  ...(mod.purchaseAvailable !== undefined
    ? { purchaseAvailable: mod.purchaseAvailable }
    : {}),
  price: mod.price,
  priceBasis: policy.priceBasis,
  tagline: mod.tagline,
  description: mod.description,
  ...(mod.newCheckoutHeld !== undefined
    ? { newCheckoutHeld: mod.newCheckoutHeld }
    : {}),
  ...(mod.demoUrl !== undefined ? { demoUrl: mod.demoUrl } : {}),
});

export function createCatalogServer(
  options: {
    presentation?: readonly CatalogPresentation[];
    foundationProduct?: FoundationPublicProduct | null;
    canListFoundation?: boolean;
  } = {},
) {
  const base = validateCatalog(catalogData);
  const catalog = options.presentation
    ? applyCatalogPresentation(base, options.presentation)
    : base;
  const mods = Object.values(catalog);
  const foundation = options.foundationProduct
    ? FoundationPublicProductSchema.parse(options.foundationProduct)
    : null;
  const publicSetup = (mod: PresentedMod) => {
    const source = base[mod.id]!;
    return {
      ...setupOverview(source),
      requirements:
        source.requires ??
        (source.runtime
          ? [
              "Node.js " + source.runtime.node,
              source.runtime.database + " on persistent local storage",
              source.runtime.processScope,
            ]
          : [
              "Node.js 22.13+",
              "PostgreSQL 17",
              "Hosting for the included Node service; queued workflows also require its background worker.",
            ]),
    };
  };
  const server = new McpServer(
    { name: "helpfulmods-public-catalog", version: "0.1.0" },
    {
      instructions:
        "Read-only public HelpfulMods catalog. Source facts are pinned by source hash; configured owner presentation and discovery visibility may be applied separately. newCheckoutHeld describes an owner control, not buyer eligibility or verified purchase availability. Never infer buyer identity, payment, entitlement, verified compatibility, or successful installation from this catalog. Use the purchased package for complete setup instructions.",
    },
  );
  server.registerTool(
    "search_catalog",
    {
      title: "Search Helpful Mods",
      description:
        "Find TypeScript source mods for a feature you need, or find Foundation Kit when listed. This public lookup returns mod summaries with IDs and catalog prices, the total mod match count, separate kit matches when available, and pricing policy. Results are limited to a single page, with empty arrays for no matches. Use get_mod_details for a product's full record or get_setup_overview for prerequisites.",
      inputSchema: z.strictObject({
        query: z.string().trim().max(240).default("").describe(
          'Keywords or a short description of the feature you need, such as "Stripe billing" or "team workspaces". Omit or leave blank to browse.',
        ),
        category: z.string().trim().min(1).max(80).optional().describe(
          'Filter by a catalog category. Use "application" to look for Foundation Kit. Omit to search all categories.',
        ),
        limit: z.number().int().min(1).max(50).default(16).describe(
          "Maximum number of standalone mod summaries to return, from 1 to 50. Defaults to 16. Foundation Kit matches are counted separately.",
        ),
      }),
      annotations,
    },
    ({ query, category, limit }) => {
      const matches = searchCatalog(mods, query, category);
      return result({
        mods: matches.slice(0, limit).map(summary),
        total: matches.length,
        ...(foundation
          ? {
              kits: foundationSearchMatches(foundation, query, category)
                ? [foundation]
                : [],
              kitTotal: foundationSearchMatches(foundation, query, category)
                ? 1
                : 0,
            }
          : {}),
        policy,
        sourceSha256,
      });
    },
  );

  server.registerTool(
    "prepare_cart_link",
    {
      title: "Prepare a Helpful Mods cart",
      description:
        "Build a public cart link after the buyer has chosen products. Returns the link and the selected IDs, omitting standalone mods already included in the selected Foundation Kit. Unknown or duplicate IDs return an error. The buyer can review the cart before signing in and confirming the final total and payment at checkout.",
      inputSchema: z.strictObject({
        productIds: z
          .array(publicProductId)
          .min(1)
          .max((options.canListFoundation ?? Boolean(foundation)) ? 26 : 25)
          .refine(
            (ids) => new Set(ids).size === ids.length,
            "Select each product once.",
          )
          .describe("Distinct listed product IDs from search_catalog. Include each ID once."),
      }),
      annotations,
    },
    ({ productIds }) => {
      const included =
        foundation && productIds.includes(foundation.id)
          ? new Set(
              foundation.composition.components.map(
                (item) => item.productId as string,
              ),
            )
          : new Set<string>();
      const normalized = productIds.filter((id) => !included.has(id));
      if (normalized.some((id) => !catalog[id] && id !== foundation?.id))
        return toolError("Choose listed product IDs from the public catalog.");
      const url = new URL("https://helpfulmods.com/cart.html");
      url.searchParams.set("products", normalized.join(","));
      return result({
        url: url.href,
        productIds: normalized,
        financialAuthority: false,
        requiresHumanConfirmation: true,
      });
    },
  );
  server.registerTool(
    "get_mod_details",
    {
      title: "Read mod details",
      description:
        "Look up the full public catalog record for a standalone mod or Foundation Kit after finding its ID with search_catalog. Returns its price, published features and limits where supplied, and pricing policy. Unknown and hidden IDs return the same error. Use get_setup_overview for setup steps or get_compatibility_guidance to compare published mod support with your stack.",
      inputSchema: z.strictObject({ id: publicProductId }),
      annotations,
    },
    ({ id }) =>
      id === foundation?.id
        ? result({ kit: foundation, policy, sourceSha256 })
        : catalog[id]
          ? result({ mod: catalog[id], policy, sourceSha256 })
          : toolError(`Unknown public catalog mod: ${id}`),
  );
  server.registerTool(
    "get_setup_overview",
    {
      title: "Read setup overview",
      description:
        "See what it takes to set up a standalone mod or Foundation Kit before you buy. Returns public requirements, setup steps, verification checks, and paths to relevant files inside the purchased package where applicable. Unknown and hidden IDs return the same error. Use get_mod_details for features and pricing.",
      inputSchema: z.strictObject({ id: publicProductId }),
      annotations,
    },
    ({ id }) =>
      id === foundation?.id
        ? result({ ...foundationSetup(foundation), sourceSha256 })
        : catalog[id]
          ? result({ ...publicSetup(catalog[id]), sourceSha256 })
          : toolError(`Unknown public catalog mod: ${id}`),
  );
  server.registerTool(
    "get_compatibility_guidance",
    {
      title: "Read compatibility guidance",
      description:
        "Review published support for up to eight standalone mods before choosing what to install. Returns the stack you supplied alongside each mod's supported features, limitations, and questions to check against your application. Confirm the fit in your own project. Unknown or hidden IDs return an error.",
      inputSchema: z.strictObject({
        ids: z.array(standaloneModId).min(1).max(8).describe(
          "One to eight standalone mod IDs returned by search_catalog.",
        ),
        environment: z.string().trim().min(1).max(1000).describe(
          'Describe the application stack you plan to use, such as "Node.js, Next.js, PostgreSQL, and Firebase Auth".',
        ),
      }),
      annotations,
    },
    ({ ids, environment }) => {
      const unknown = ids.filter((id) => !catalog[id]);
      if (unknown.length)
        return toolError(`Unknown public catalog mods: ${unknown.join(", ")}`);
      return result({
        environment,
        assessment:
          "Not verified. Compare the published scope below with your project and the purchased package requirements.",
        mods: [...new Set(ids)].map((id) => {
          const mod = catalog[id]!;
          return {
            id,
            version: mod.version,
            description: mod.description,
            supported: mod.supported ?? [],
            limitations: mod.limitations ?? [],
            boundary: mod.boundary,
            questions: mod.questions,
          };
        }),
        sourceSha256,
      });
    },
  );

  const resources: Array<{
    name: string;
    uri: string;
    description: string;
    data: unknown;
  }> = [
    {
      name: "public-catalog",
      uri: "helpfulmods://catalog",
      description:
        "Public mod source preparation summaries, pinned catalog hash and one-time purchase policy.",
      data: { mods: mods.map(summary), policy, sourceSha256 },
    },
    {
      name: "purchase-policy",
      uri: "helpfulmods://policy",
      description:
        "Public pricing and included support policy; no buyer-specific quote or availability check.",
      data: { policy },
    },
    ...mods.map((mod) => ({
      name: `${mod.id}-details`,
      uri: `helpfulmods://mods/${mod.id}`,
      description: `${mod.name} ${mod.version}: public scope and setup overview.`,
      data: { mod, setup: publicSetup(mod), policy, sourceSha256 },
    })),
  ];
  if (foundation)
    resources.push({
      name: "foundation-kit-details",
      uri: "helpfulmods://kits/foundation-kit",
      description:
        "Foundation Kit connected application, source composition and setup overview; no purchase or grant.",
      data: {
        kit: foundation,
        setup: foundationSetup(foundation),
        policy,
        sourceSha256,
      },
    });
  for (const resource of resources)
    server.registerResource(
      resource.name,
      resource.uri,
      { description: resource.description, mimeType: "application/json" },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(resource.data, null, 2),
          },
        ],
      }),
    );
  // SDK rejects all unregistered resource URIs. No URL or filesystem retrieval occurs.
  return server;
}
