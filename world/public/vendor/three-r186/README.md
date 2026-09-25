three.js r186 (0.186.1), MIT (see LICENSE). Vendored so the dashboard runs offline under a strict
Content-Security-Policy (no third-party script hosts).

Built from the npm package with esbuild `--minify --format=esm`, keeping ES module imports:
- `three.core.min.js` from `build/three.core.js`
- `three.module.min.js` from `build/three.module.js` (import rewritten to `./three.core.min.js`)
- `OrbitControls.min.js` from `examples/jsm/controls/OrbitControls.js` (import `'three'` rewritten to `./three.module.min.js`)
