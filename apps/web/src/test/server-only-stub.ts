// Test-only stub for the `server-only` package.
//
// The real module throws when imported outside a React Server Component. Under
// vitest there is no RSC boundary, so importing it would fail every test of a
// server module. The guard still applies in real builds.
export {};
