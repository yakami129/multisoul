// Custom test environment that pre-defines globals to prevent
// expo/src/winter/installGlobal.ts from setting up lazy getters
// that load runtime.native.ts (which uses ESM import).
const { TestEnvironment } = require('jest-environment-node');

class CustomReactNativeEnv extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    // Pre-define structuredClone as non-configurable so expo's installGlobal
    // cannot overwrite it with a lazy getter that loads runtime.native.ts
    if (!this.global.structuredClone) {
      Object.defineProperty(this.global, 'structuredClone', {
        value: (obj) => JSON.parse(JSON.stringify(obj)),
        enumerable: true,
        writable: true,
        configurable: false,
      });
    }
  }
}

module.exports = CustomReactNativeEnv;
