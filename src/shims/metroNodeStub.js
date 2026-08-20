const path = require('path');

/**
 * React Native has no Node builtins. @anthropic-ai/sdk's client.mjs imports a
 * constant from a module that also contains `await import('node:fs')`, and
 * Metro resolves dynamic imports at bundle time without tree-shaking, so the
 * native bundle fails on a code path this app never calls.
 *
 * Web is left alone: it has its own Node shims and is the path used daily in
 * the browser.
 */
function isStubbedOnNative(moduleName, platform) {
  return platform !== 'web' && moduleName.startsWith('node:');
}

const EMPTY_MODULE = path.join(__dirname, 'empty.js');

module.exports = { isStubbedOnNative, EMPTY_MODULE };
