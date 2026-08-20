const { getDefaultConfig } = require('expo/metro-config');
const { isStubbedOnNative, EMPTY_MODULE } = require('./src/shims/metroNodeStub');

const config = getDefaultConfig(__dirname);

// Without this the iOS bundle fails to build. See src/shims/metroNodeStub.js.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (isStubbedOnNative(moduleName, platform)) {
    return { type: 'sourceFile', filePath: EMPTY_MODULE };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
