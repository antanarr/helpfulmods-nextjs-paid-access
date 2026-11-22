import { z } from "zod";
import { containsSearchTerms, normalizeSearchText, searchTerms } from "./search.js";

const text = z.string().min(1).max(1500);
const version = z.string().regex(/^\d+\.\d+\.\d+$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const archive = z.strictObject({
  key: z.string().min(1).max(2048),
  sha256: digest,
  size: z.number().int().positive(),
});
const component = z.strictObject({
  productId: z.enum([
    "funnel",
    "teams",
    "onboarding",
    "notifications",
    "support",
  ]),
  version,
  licenseVersion: version,
  archive,
});
const composition = z
  .strictObject({
    formatVersion: z.literal(1),
    productId: z.literal("foundation-kit"),
    version,
    licenseVersion: version,
    archive,
    terms: z.strictObject({
      licensedApplications: z.literal(1),
      setupSupportDays: z.literal(30),
      fixesIncludedMonths: z.literal(12),
    }),
    components: z.array(component).length(5),
  })
  .superRefine((value, ctx) => {
    if (
      value.components.map((item) => item.productId).join(",") !==
      "funnel,teams,onboarding,notifications,support"
    )
      ctx.addIssue({
        code: "custom",
        message: "Foundation component selection changed.",
      });
  });
/** Separate connected application; never admitted to the individual Mod schema. */
export const FoundationPublicProductSchema = z
  .strictObject({
    id: z.literal("foundation-kit"),
    productKind: z.literal("foundation-kit"),
    purchaseMode: z.literal("human_cart"),
    name: text,
    description: text,
    version,
    price: z.literal(199),
    returningCustomerPrice: z.literal(199),
    currency: z.literal("USD"),
    priceBasis: z.literal("before applicable tax"),
    purchaseAvailable: z.boolean(),
    url: z.literal("https://helpfulmods.com/foundation/"),
    composition,
    compositionSha256: digest,
    setup: z.strictObject({
      requirements: z.array(text).min(1).max(20),
      workflow: z.array(text).min(1).max(20),
      verification: z.array(text).min(1).max(20),
      buyerResources: z
        .array(
          z.strictObject({ path: z.string().min(1).max(120), purpose: text }),
        )
        .min(1)
        .max(20),
    }),
  })
  .superRefine((value, ctx) => {
    if (value.version !== value.composition.version)
      ctx.addIssue({
        code: "custom",
        message: "Foundation source version differs from composition.",
      });
  });
export type FoundationPublicProduct = z.infer<
  typeof FoundationPublicProductSchema
>;
export function foundationSearchMatches(
  product: FoundationPublicProduct,
  query: string,
  category?: string,
) {
  if (
    category &&
    !["application", "foundation kit"].includes(normalizeSearchText(category))
  )
    return false;
  const haystack = [
    product.name,
    product.description,
    "foundation starter connected application kit SaaS B2B accounts workspaces billing projects onboarding notifications support authentication authenticate auth user login signup sign in Firebase Google GitHub OAuth multi tenancy multi tenant multitenancy multitenant tenant isolation",
    ...product.setup.requirements,
    ...product.composition.components.map((item) => item.productId),
  ]
    .join(" ");
  const terms = searchTerms(query);
  return (!query.trim() || terms.length > 0) && containsSearchTerms(haystack, terms);
}
export function foundationSetup(product: FoundationPublicProduct) {
  return {
    id: product.id,
    productKind: product.productKind,
    version: product.version,
    price: product.price,
    returningCustomerPrice: product.returningCustomerPrice,
    purchaseMode: product.purchaseMode,
    purchaseAvailable: product.purchaseAvailable,
    ...product.setup,
    composition: product.composition,
    compositionSha256: product.compositionSha256,
    resourceLocation:
      "Paths are relative to the purchased Foundation Kit. This public catalog grants no source access or installation authority.",
  };
}
