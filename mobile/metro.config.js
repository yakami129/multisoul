const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes('txt')) {
  config.resolver.assetExts.push('txt');
}

// Exclude test files from the production bundle
config.resolver.blockList = [
  /.*\.(test|spec)\.(js|jsx|ts|tsx)$/,
  /.*\/__tests__\/.*/,
];

module.exports = withNativeWind(config, { input: './global.css' });
