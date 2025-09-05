// File: babel.config.js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Order matters: expo-router first, reanimated LAST
    plugins: ['expo-router/babel', 'react-native-reanimated/plugin'],
  };
};
