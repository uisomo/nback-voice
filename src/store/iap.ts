import {
  endConnection,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  requestPurchase,
  verifyPurchase,
  type Purchase,
  type ProductSubscription,
} from 'expo-iap';
import type { SubscriptionTier } from './storage';

export type BillingCycle = 'monthly' | 'annual';

/**
 * Product IDs, grouped in one App Store Connect subscription group so
 * upgrading pro -> god (or switching billing cycle) prorates instead of
 * stacking two concurrent subscriptions.
 */
export const IAP_SKUS = {
  pro: {
    monthly: 'com.nbackvoice.app.pro.monthly',
    annual: 'com.nbackvoice.app.pro.annual',
  },
  god: {
    monthly: 'com.nbackvoice.app.god.monthly',
    annual: 'com.nbackvoice.app.god.annual',
  },
} as const satisfies Record<Exclude<SubscriptionTier, 'free'>, Record<BillingCycle, string>>;

export const ALL_SKUS: string[] = Object.values(IAP_SKUS).flatMap((cycles) => Object.values(cycles));

const SKU_TO_TIER: Record<string, Exclude<SubscriptionTier, 'free'>> = Object.fromEntries(
  (Object.entries(IAP_SKUS) as [Exclude<SubscriptionTier, 'free'>, Record<BillingCycle, string>][]).flatMap(
    ([tier, cycles]) => Object.values(cycles).map((sku) => [sku, tier]),
  ),
);

function tierForSku(sku: string): Exclude<SubscriptionTier, 'free'> | null {
  return SKU_TO_TIER[sku] ?? null;
}

export async function fetchSubscriptionProducts(): Promise<ProductSubscription[]> {
  const result = await fetchProducts({ skus: ALL_SKUS, type: 'subs' });
  return result as ProductSubscription[];
}

/**
 * A purchase only counts once StoreKit's own signature is confirmed valid
 * for that sku — the JWS check is what stands in for server-side receipt
 * validation in this app's no-backend design.
 */
async function isGenuineApplePurchase(purchase: Purchase): Promise<boolean> {
  const result = await verifyPurchase({ apple: { sku: purchase.productId } });
  return 'isValid' in result && result.isValid === true;
}

/**
 * Resolve a verified purchase to the tier it grants, or null if the
 * purchase's signature doesn't check out (never grant entitlement for it).
 */
export async function resolvePurchaseTier(purchase: Purchase): Promise<SubscriptionTier | null> {
  const tier = tierForSku(purchase.productId);
  if (!tier) return null;
  const genuine = await isGenuineApplePurchase(purchase);
  return genuine ? tier : null;
}

export function requestSubscriptionPurchase(tier: Exclude<SubscriptionTier, 'free'>, cycle: BillingCycle) {
  return requestPurchase({
    request: { apple: { sku: IAP_SKUS[tier][cycle] } },
    type: 'subs',
  });
}

/**
 * The highest tier among the caller's currently-held, verified purchases,
 * or 'free' if none verify. Used both for the launch-time sync and for
 * "restore purchases" — same resolution logic either way.
 *
 * Owns its own store connection (rather than relying on useIAP's
 * hook-lifetime connection) since this is called both from a mounted
 * SubscriptionModal and once at app launch, before any modal exists.
 * Falls back to 'free' on any store error (e.g. offline, or no App Store
 * account) rather than throwing — losing entitlement info is safer than
 * crashing launch.
 */
export async function resolveEntitledTier(): Promise<SubscriptionTier> {
  try {
    await initConnection();
    const purchases = await getAvailablePurchases();
    const tiers = await Promise.all(purchases.map(resolvePurchaseTier));
    if (tiers.includes('god')) return 'god';
    if (tiers.includes('pro')) return 'pro';
    return 'free';
  } catch {
    return 'free';
  } finally {
    await endConnection().catch(() => undefined);
  }
}

export async function finishSubscriptionPurchase(purchase: Purchase): Promise<void> {
  await finishTransaction({ purchase, isConsumable: false });
}
