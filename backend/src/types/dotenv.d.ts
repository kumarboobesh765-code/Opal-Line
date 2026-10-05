// dotenv 18 moved its type declarations behind the package `exports` map
// (dist/config.d.ts) and dropped the root-level config.d.ts that TypeScript's
// `node10` module resolution used to find. This backend is CommonJS and stays
// on node10 — switching to node16 would require explicit `.js` extensions on
// every relative import across the codebase (179 errors), which is a much
// larger change than a dotenv bump warrants.
//
// `dotenv/config` is a side-effect import: it loads .env and exports nothing,
// so there are no member types to preserve. Node resolves it correctly at
// runtime under CommonJS (verified); this declaration only restores type
// resolution for the compiler.
declare module 'dotenv/config';