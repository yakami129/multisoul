// Mock for expo/src/winter/runtime.native
// The real file uses ESM `import` which fails in Jest's CommonJS environment.
// This no-op mock prevents the error.
module.exports = {};
