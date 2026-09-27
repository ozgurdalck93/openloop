const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite on web runs SQLite as WebAssembly (wa-sqlite) in a worker. Only used when
// the app is opened in a browser — e.g. by `npm run e2e:web` — never on iOS/Android.
config.resolver.assetExts.push('wasm');

// wa-sqlite needs SharedArrayBuffer, which browsers only allow on cross-origin-isolated pages.
config.server = config.server ?? {};
const enhanceMiddleware = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const inner = enhanceMiddleware ? enhanceMiddleware(middleware, server) : middleware;
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    return inner(req, res, next);
  };
};

module.exports = config;
