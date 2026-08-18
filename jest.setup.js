jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// The repo lives on /mnt/c (the Windows filesystem seen from WSL2), where the
// first render in a suite pays several seconds of module-load and transform
// cost before any assertion runs. Jest's 5s default fails that first test
// while every later one in the same file passes — a timing artefact of the
// filesystem, not of the code under test.
jest.setTimeout(30000);
