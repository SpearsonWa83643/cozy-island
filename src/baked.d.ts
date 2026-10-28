/** Order 48c: build-time baked tiles (scripts/vite-bake-plugin.mjs); null in dev. */
declare module 'virtual:cozy-baked' {
  const baked: { islets: Record<string, { url: string; n: number; bytes: number }> } | null;
  export default baked;
}
