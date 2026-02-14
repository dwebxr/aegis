// Suppress noisy console output from error-path tests.
// Individual tests can still spy on console methods to verify calls
// since jest.spyOn replaces the implementation and takes precedence.
const noop = () => {};
console.warn = noop;
console.error = noop;
console.debug = noop;
