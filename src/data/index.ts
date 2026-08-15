// src/data/index.ts
// The full mod resolves plantCatalog dynamic-first (live fetch from its own
// API) with this file as static fallback. For a standalone tool we just use
// the static catalog directly — no network dependency needed to map a seed's
// display name (e.g. "Tulip Seed") back to its species id.
export { plantCatalog } from "./hardcoded-data.clean.js";
