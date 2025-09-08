// File: babel.config.js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Reanimated plugin MUST stay last
      'react-native-reanimated/plugin',
    ],
  };
};
