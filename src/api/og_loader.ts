/**
 * Lazy loader for the OG image generator module. Isolated in its own file because
 * `./og` pulls in satori/resvg WASM that the vitest Workers pool can't instantiate.
 * Excluded from coverage in vitest.config.mts.
 */
export const ogLoader = () => import('./og');
