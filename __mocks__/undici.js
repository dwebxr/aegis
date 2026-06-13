// Test mock for `undici`. Production safeFetch uses undici's own fetch (the
// npm-undici Agent is incompatible with Node's builtin global fetch across major
// versions), but the test suite simulates the network by mocking global.fetch.
// Routing undici.fetch → globalThis.fetch keeps every existing global.fetch mock
// working unchanged. The pinning Agent is a no-op stub here; the connection-time
// SSRF guard it carries is exercised directly via unit tests on lib/utils/ssrf
// (checkPrivateAddress + makePrivateIPRejectingLookup).
//
// Crucially we STRIP the `dispatcher` option before delegating: the stub Agent is
// not a real undici dispatcher, so passing it to the genuine globalThis.fetch
// (in tests that hit the real network rather than mocking it) would break the
// request. Stripping it lets those tests behave exactly as on the pre-change base.
module.exports = {
  fetch: (input, init) => {
    if (init && typeof init === "object" && "dispatcher" in init) {
      const { dispatcher: _dispatcher, ...rest } = init;
      return globalThis.fetch(input, rest);
    }
    return globalThis.fetch(input, init);
  },
  Agent: class Agent {
    constructor() {}
    dispatch() {}
    close() {}
    destroy() {}
  },
};
