const {
  isStubbedOnNative,
  EMPTY_MODULE,
} = require('../shims/metroNodeStub.js');

/**
 * The iOS bundle fails without this rule, and it fails only at build time —
 * no test or browser run reveals it. `npm run check:bundle` proves the wiring;
 * this proves the rule.
 */
describe('metro node-builtin stub', () => {
  it('stubs node builtins on iOS and Android', () => {
    expect(isStubbedOnNative('node:fs', 'ios')).toBe(true);
    expect(isStubbedOnNative('node:crypto', 'android')).toBe(true);
  });

  it('leaves web alone — it has its own shims and is the daily path', () => {
    expect(isStubbedOnNative('node:fs', 'web')).toBe(false);
  });

  it('does not touch ordinary modules', () => {
    expect(isStubbedOnNative('react-native', 'ios')).toBe(false);
    expect(isStubbedOnNative('@anthropic-ai/sdk', 'ios')).toBe(false);
  });

  it('points at a module that exists and exports nothing', () => {
    expect(require(EMPTY_MODULE)).toEqual({});
  });
});
