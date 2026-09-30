const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * @react-native/virtualized-lists deep-imports this private react-native file, which isn't in
 * react-native's "exports", so Metro warns on every bundle. Point it straight at the file.
 */
const PRIVATE_DEEP_IMPORTS = {
  'react-native/src/private/featureflags/ReactNativeFeatureFlags': path.join(
    path.dirname(require.resolve('react-native/package.json')),
    'src/private/featureflags/ReactNativeFeatureFlags.js',
  ),
};

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    resolveRequest: (context, moduleName, platform) => {
      const filePath = PRIVATE_DEEP_IMPORTS[moduleName];
      if (filePath) {
        return { type: 'sourceFile', filePath };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
