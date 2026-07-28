# Pond reed clumps

Procedural pond reed clumps for [three.js](https://threejs.org). Four clump
variants, each 4&ndash;10 stems, built as merged geometry so any of them can be
instanced thousands of times with random rotation, scale and lean.

```bash
npm install
npm run dev      # demo scene at http://localhost:5173
npm run verify   # headless geometry checks, no WebGL needed
```

## The four variants

| key | label | stems | notes |
| --- | --- | --- | --- |
| `sparseStraight` | Sparse Straight | 4&ndash;6 | Well-spaced, near-vertical. Open water edge. |
| `denseTall` | Dense Tall | 8&ndash;10 | Packed mature stand, tallest of the set, most stems carry a seed head. |
| `bent` | Bent | 5&ndash;7 | Wind-laid, arcing hard toward one shared heading. |
| `shortYoung` | Short Young | 5&ndash;8 | New growth: short, thin, bright, no seed heads. |

Each clump is stems plus a few drooping leaf blades, and a seed head on some
stems of the mature variants.

## Usage

```js
import { createReedClumpInstances, createReedBed, getSharedReedMaterial } from './src/reeds.js';

// One variant, 500 copies, one draw call.
scene.add(createReedClumpInstances('denseTall', 500, {
  seed: 42,
  radius: 12,                 // default placement: uniform over a disc
  scale: [0.75, 1.3],         // uniform scale range
  heightScale: [0.9, 1.15],   // extra vertical stretch
  lean: [0, 0.14],            // radians, about the root
}));

// Or all four variants at once (one InstancedMesh each).
scene.add(createReedBed({
  counts: { sparseStraight: 120, denseTall: 90, bent: 70, shortYoung: 160 },
  radius: 10,
}));
```

Placement is pluggable &mdash; pass `placement(rng, target)` to put clumps where
you want (the demo uses an annulus so they hug the pond edge):

```js
createReedClumpInstances('bent', 80, {
  placement: (rng, target) => {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(64 + rng() * 36);   // ring from r=8 to r=10
    return target.set(Math.cos(a) * r, 0, Math.sin(a) * r);
  },
});
```

Single clump, for inspection or hand placement:

```js
import { createReedClump } from './src/reeds.js';
const clump = createReedClump('bent', { seed: 7 });
```

### API

| export | purpose |
| --- | --- |
| `REED_VARIANTS`, `REED_VARIANT_NAMES` | variant definitions and their keys |
| `buildReedClumpGeometry(variant, opts)` | one merged `BufferGeometry` |
| `getReedClumpGeometry(variant, seed)` | same, memoised per `variant:seed` |
| `createReedClump(variant, opts)` | a single `Mesh` |
| `createReedClumpInstances(variant, count, opts)` | an `InstancedMesh` |
| `createReedBed(opts)` | a `Group`, one `InstancedMesh` per variant |
| `getSharedReedMaterial(overrides)` | the shared material |
| `makeRng(seed)` | the deterministic PRNG, for your own placement |
| `disposeReedGeometryCache()`, `disposeSharedReedMaterial()` | cleanup |

`seed` selects a clump's shape within its variant's ranges &mdash; same seed,
same clump, every run. Use `geometrySeed` on the instancing calls to change the
shape being instanced, and `seed` to change the scatter.

## How the requirements are met

**Pivot at the root, base at y = 0.** Every stalk is integrated from the origin
upward, and the clump's local origin sits on the root of its centre stem. After
merging, any vertex below zero (the fraction of a millimetre a leaning base cap
ring dips) is clamped, so `boundingBox.min.y` is exactly `0`. That is what makes
the per-instance lean work: rotating about the origin tips the clump over
without lifting it off the ground or sinking it in.

**Several vertical subdivisions.** Stalks are swept as tapered tubes over
8&ndash;14 rings depending on variant, so the generator can bend them smoothly
&mdash; and so a vertex shader could add wind sway later without the stalks
creasing.

**Shared material.** All four variants render with one
`MeshStandardMaterial`. Colour differences &mdash; green stalks with a
base-to-tip gradient, darker blades, straw seed heads &mdash; are baked into a
vertex-colour attribute rather than split across materials. Leaf blades carry a
mirrored copy of their triangles with flipped normals, so they read correctly
from both sides without needing a `DoubleSide` material. Per-instance tint adds
subtle variation on top via `InstancedMesh.setColorAt`.

**No skeletal animation.** Bend is baked into the geometry. No bones, no
skinning.

The demo renders 602 clumps &mdash; about 920k triangles &mdash; in 5 draw calls
against 1 material.

## Layout

```
index.html          demo page
src/reeds.js        the generator (the reusable part)
src/demo.js         demo scene: pond, reed beds, specimen row
scripts/verify.mjs  headless invariant checks
scripts/screenshot.mjs  renders the demo to PNGs via Playwright
```

`npm run verify` asserts the invariants above directly against the built
geometry: stem counts land in 4&ndash;10, `min.y` is exactly 0, vertices exist at
the pivot, normals are unit length, indices are in range, all four variants share
one material, and instance transforms keep every root on the ground plane.

## Extending

The demo is static by design. Because the stalks are already subdivided
vertically and every clump's pivot is at its root, wind sway is a natural next
step: `onBeforeCompile` on the shared material, displacing by a function of
`position.y` so the base stays planted and the tips move most.
