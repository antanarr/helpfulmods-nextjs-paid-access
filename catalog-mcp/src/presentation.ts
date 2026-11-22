import { z } from 'zod';
import type { Catalog, Mod } from './catalog.js';

export interface CatalogPresentation {
  productId: string;
  discoverable: boolean;
  purchasable: boolean;
  /** Current commerce qualification supplied by the host, beyond the owner switch. */
  purchaseAvailable?: boolean;
  name?: string;
  summary?: string;
  demoUrl?: string | null;
}
export type CatalogPresentationReader = (productIds: readonly string[]) => Promise<readonly CatalogPresentation[]>;
export type PresentedMod = Omit<Mod, 'status'> & { status: Mod['status'] | 'unavailable'; purchaseAvailable?: boolean; demoUrl?: string | null; newCheckoutHeld?: boolean };
const text = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length>0 && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value));
const presentation = z.strictObject({
  productId: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
  discoverable: z.boolean(), purchasable: z.boolean(),
  purchaseAvailable: z.boolean().optional(),
  name: text(120).optional(), summary: text(1500).optional(),
  demoUrl: z.url().max(2000).refine(value => {const url=new URL(value);return url.protocol==='https:' && !url.username && !url.password;}).nullable().optional(),
});

/** Project before SDK tool/resource registration; immutable source facts and prices are preserved. */
export function applyCatalogPresentation(base: Catalog, input: readonly CatalogPresentation[]): Readonly<Record<string, PresentedMod>> {
  const rows=z.array(presentation).max(200).parse(input);
  const result: Record<string, PresentedMod>=Object.create(null);
  for(const [id,mod] of Object.entries(base))result[id]={...mod};
  const seen=new Set<string>();
  for(const row of rows){
    if(!Object.hasOwn(base,row.productId) || seen.has(row.productId))throw new Error('Invalid catalog presentation selection.');
    seen.add(row.productId);
    if(!row.discoverable){delete result[row.productId];continue;}
    result[row.productId]={...base[row.productId]!,...(row.purchaseAvailable!==undefined?{purchaseAvailable:row.purchaseAvailable && row.purchasable,status:row.purchaseAvailable && row.purchasable?'available' as const:'unavailable' as const}:{}),...(row.name!==undefined?{name:row.name}:{}),...(row.summary!==undefined?{description:row.summary}:{}),...(row.demoUrl!==undefined?{demoUrl:row.demoUrl}:{}),newCheckoutHeld:!row.purchasable};
  }
  return Object.freeze(result);
}
