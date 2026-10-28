// Order 48c: Vite plugin that bakes islet height tiles during `vite build` and exposes their hashed URLs via
// `virtual:cozy-baked`. In dev (`vite` on 5180) nothing is baked: the module exports null and islets keep
// generating in the gen worker. `?bake=off` does the same on a built site.
import { bakeTiles } from './bake.mjs';

const ID = 'virtual:cozy-baked', RID = '\0' + ID;
export default function cozyBake() {
  let isBuild = false;
  return {
    name: 'cozy-bake',
    configResolved(c) { isBuild = c.command === 'build' && !c.build.ssr; },
    resolveId(id) { return id === ID ? RID : null; },
    async load(id) {
      if (id !== RID) return null;
      if (!isBuild || process.env.COZY_NO_BAKE) return 'export default null;';
      const r = await bakeTiles();
      const entries = r.tiles.map((t) => {
        const ref = this.emitFile({ type: 'asset', name: `islet-${t.id}.tile`, source: t.bytes });
        return `${JSON.stringify(t.id)}: { url: import.meta.ROLLUP_FILE_URL_${ref}, n: ${t.n}, bytes: ${t.bytes.length} }`;
      });
      const kb = r.tiles.reduce((a, t) => a + t.bytes.length, 0) / 1024;
      this.info?.(`baked ${r.tiles.length} islet tiles (${kb.toFixed(0)} KB) in ${r.ms} ms`);
      console.log(`[bake] ${r.tiles.length} islet tiles, ${kb.toFixed(0)} KB, ${r.ms} ms`);
      return `export default { islets: { ${entries.join(', ')} } };`;
    },
  };
}
