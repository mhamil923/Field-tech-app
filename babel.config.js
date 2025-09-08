// File: babel.config.js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      'expo-router/babel',
      // Keep this LAST:
      'react-native-reanimated/plugin',
    ],
  };
};
