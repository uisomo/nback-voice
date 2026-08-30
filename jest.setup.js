jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// expo-iap's native module doesn't exist under jest (no real device/simulator
// backing it), and useIAP() connects on mount — so anything that renders
// SubscriptionModal, even with visible={false}, needs this mocked globally
// rather than per test file.
jest.mock('expo-iap', () => ({
  useIAP: () => ({
    connected: false,
    products: [],
    subscriptions: [],
    availablePurchases: [],
    activeSubscriptions: [],
    finishTransaction: jest.fn(),
    getAvailablePurchases: jest.fn(),
    fetchProducts: jest.fn(),
    requestPurchase: jest.fn(),
    verifyPurchase: jest.fn(),
    restorePurchases: jest.fn(),
  }),
  initConnection: jest.fn().mockResolvedValue(true),
  endConnection: jest.fn().mockResolvedValue(undefined),
  fetchProducts: jest.fn().mockResolvedValue([]),
  getAvailablePurchases: jest.fn().mockResolvedValue([]),
  requestPurchase: jest.fn(),
  finishTransaction: jest.fn(),
  verifyPurchase: jest.fn(),
}));

// The repo lives on /mnt/c (the Windows filesystem seen from WSL2), where the
// first render in a suite pays several seconds of module-load and transform
// cost before any assertion runs. Jest's 5s default fails that first test
// while every later one in the same file passes — a timing artefact of the
// filesystem, not of the code under test.
jest.setTimeout(30000);
