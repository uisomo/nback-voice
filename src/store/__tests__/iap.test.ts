import {
  endConnection,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  requestPurchase,
  verifyPurchase,
} from 'expo-iap';
import {
  ALL_SKUS,
  IAP_SKUS,
  fetchSubscriptionProducts,
  finishSubscriptionPurchase,
  requestSubscriptionPurchase,
  resolveEntitledTier,
  resolvePurchaseTier,
} from '../iap';

jest.mock('expo-iap', () => ({
  endConnection: jest.fn(),
  fetchProducts: jest.fn(),
  finishTransaction: jest.fn(),
  getAvailablePurchases: jest.fn(),
  initConnection: jest.fn(),
  requestPurchase: jest.fn(),
  verifyPurchase: jest.fn(),
}));

function purchase(productId: string) {
  return {
    id: 't1',
    productId,
    isAutoRenewing: true,
    purchaseState: 'purchased',
    quantity: 1,
    store: 'apple',
    transactionDate: 0,
  } as const;
}

describe('iap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (initConnection as jest.Mock).mockResolvedValue(true);
    (endConnection as jest.Mock).mockResolvedValue(undefined);
  });

  it('lists every pro/god monthly/annual sku', () => {
    expect(ALL_SKUS).toEqual([
      IAP_SKUS.pro.monthly,
      IAP_SKUS.pro.annual,
      IAP_SKUS.god.monthly,
      IAP_SKUS.god.annual,
    ]);
  });

  it('fetches subscription products by the full sku list', async () => {
    (fetchProducts as jest.Mock).mockResolvedValue([{ id: IAP_SKUS.pro.monthly }]);
    const result = await fetchSubscriptionProducts();
    expect(fetchProducts).toHaveBeenCalledWith({ skus: ALL_SKUS, type: 'subs' });
    expect(result).toEqual([{ id: IAP_SKUS.pro.monthly }]);
  });

  it('requests a purchase for the sku matching tier and cycle', async () => {
    (requestPurchase as jest.Mock).mockResolvedValue(undefined);
    await requestSubscriptionPurchase('god', 'annual');
    expect(requestPurchase).toHaveBeenCalledWith({
      request: { apple: { sku: IAP_SKUS.god.annual } },
      type: 'subs',
    });
  });

  it('resolves a purchase to its tier when the signature verifies', async () => {
    (verifyPurchase as jest.Mock).mockResolvedValue({ isValid: true });
    const tier = await resolvePurchaseTier(purchase(IAP_SKUS.pro.monthly));
    expect(verifyPurchase).toHaveBeenCalledWith({ apple: { sku: IAP_SKUS.pro.monthly } });
    expect(tier).toBe('pro');
  });

  it('refuses to grant a tier when the signature does not verify', async () => {
    (verifyPurchase as jest.Mock).mockResolvedValue({ isValid: false });
    const tier = await resolvePurchaseTier(purchase(IAP_SKUS.god.monthly));
    expect(tier).toBeNull();
  });

  it('returns null for a purchase whose sku is not one of ours', async () => {
    const tier = await resolvePurchaseTier(purchase('com.someone.else'));
    expect(tier).toBeNull();
    expect(verifyPurchase).not.toHaveBeenCalled();
  });

  it('resolves entitled tier to god when both pro and god purchases verify', async () => {
    (getAvailablePurchases as jest.Mock).mockResolvedValue([
      purchase(IAP_SKUS.pro.annual),
      purchase(IAP_SKUS.god.monthly),
    ]);
    (verifyPurchase as jest.Mock).mockResolvedValue({ isValid: true });
    expect(await resolveEntitledTier()).toBe('god');
  });

  it('resolves entitled tier to free when nothing verifies', async () => {
    (getAvailablePurchases as jest.Mock).mockResolvedValue([purchase(IAP_SKUS.pro.monthly)]);
    (verifyPurchase as jest.Mock).mockResolvedValue({ isValid: false });
    expect(await resolveEntitledTier()).toBe('free');
  });

  it('resolves entitled tier to free with no purchases at all', async () => {
    (getAvailablePurchases as jest.Mock).mockResolvedValue([]);
    expect(await resolveEntitledTier()).toBe('free');
  });

  it('falls back to free rather than throwing when the store is unavailable', async () => {
    (initConnection as jest.Mock).mockRejectedValue(new Error('offline'));
    expect(await resolveEntitledTier()).toBe('free');
    expect(endConnection).toHaveBeenCalled();
  });

  it('closes the store connection after resolving entitlement', async () => {
    (getAvailablePurchases as jest.Mock).mockResolvedValue([]);
    await resolveEntitledTier();
    expect(initConnection).toHaveBeenCalled();
    expect(endConnection).toHaveBeenCalled();
  });

  it('finishes a subscription purchase as non-consumable', async () => {
    const p = purchase(IAP_SKUS.pro.monthly);
    await finishSubscriptionPurchase(p);
    expect(finishTransaction).toHaveBeenCalledWith({ purchase: p, isConsumable: false });
  });
});
