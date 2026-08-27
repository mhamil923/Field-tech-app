// Metro config — Expo defaults plus one addition.
//
// The vendored PDF libraries (assets/pdflibs/*.js.txt) must reach the app as ASSETS
// whose source text we read at runtime, not as modules Metro tries to parse and
// execute. `.js` can't go in assetExts (it collides with sourceExts), which is why
// those files carry a trailing `.txt`.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
if (!config.resolver.assetExts.includes('txt')) {
  config.resolver.assetExts.push('txt');
}

module.exports = config;
