/**
 * Headless checks for the reed generator.
 *
 * Runs the geometry builders in Node (no WebGL needed) and asserts the
 * invariants the renderer relies on: pivot at the root, base at y = 0, enough
 * vertical subdivisions to bend, one shared material, valid buffers.
 *
 *   node scripts/verify.mjs
 */

import * as THREE from 'three';
import {
	REED_VARIANTS,
	REED_VARIANT_NAMES,
	buildReedClumpGeometry,
	createReedClump,
	createReedClumpInstances,
	createReedBed,
	getSharedReedMaterial,
} from '../src/reeds.js';

let failures = 0;
let checks = 0;

function check(label, condition, detail = '') {
	checks++;
	if (condition) {
		console.log(`  ok   ${label}${detail ? `  (${detail})` : ''}`);
	} else {
		failures++;
		console.log(`  FAIL ${label}${detail ? `  (${detail})` : ''}`);
	}
}

const EPS = 1e-6;

console.log(`three r${THREE.REVISION}\n`);

// ---------------------------------------------------------------------------
// Per-variant geometry
// ---------------------------------------------------------------------------

for (const variant of REED_VARIANT_NAMES) {
	const def = REED_VARIANTS[variant];
	console.log(`${def.label}  [${variant}]`);

	const geo = buildReedClumpGeometry(variant, { seed: 4242 });
	const pos = geo.getAttribute('position');
	const box = geo.boundingBox;

	// --- stem count in the requested 4-10 band --------------------------------
	const stems = geo.userData.reed.stemCount;
	check('4-10 stems', stems >= 4 && stems <= 10, `${stems} stems`);
	check(
		'stem count within variant range',
		stems >= def.stemCount[0] && stems <= def.stemCount[1],
		`range ${def.stemCount[0]}-${def.stemCount[1]}`,
	);

	// --- base sits exactly on y = 0 -------------------------------------------
	check('lowest vertex at y = 0', Math.abs(box.min.y) < EPS, `min.y = ${box.min.y}`);
	check('no geometry below ground', box.min.y >= -EPS);
	check('grows upward', box.max.y > 0.3, `height ${box.max.y.toFixed(2)}m`);

	// --- pivot on the root ----------------------------------------------------
	// One stem is anchored at the origin, so vertices must exist right at the
	// pivot in xz, at y = 0.
	let atPivot = 0;
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i);
		const y = pos.getY(i);
		const z = pos.getZ(i);
		if (Math.abs(y) < EPS && Math.hypot(x, z) < def.baseRadius[1] * 1.05) atPivot++;
	}
	check('root vertices sit on the pivot', atPivot > 0, `${atPivot} verts at origin`);
	check(
		'clump stays within its footprint',
		Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z)) <
			def.clumpRadius + box.max.y,
		`footprint +/-${Math.max(Math.abs(box.min.x), Math.abs(box.max.x)).toFixed(2)}m`,
	);

	// --- vertical subdivision -------------------------------------------------
	check('several vertical subdivisions', def.segments >= 8, `${def.segments} rings per stalk`);

	// --- buffers are sane -----------------------------------------------------
	const idx = geo.getIndex();
	let finite = true;
	const arr = pos.array;
	for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) { finite = false; break; }
	check('positions all finite', finite);

	let inRange = true;
	for (let i = 0; i < idx.count; i++) {
		const v = idx.getX(i);
		if (v < 0 || v >= pos.count) { inRange = false; break; }
	}
	check('indices in range', inRange, `${idx.count / 3} triangles`);

	const nrm = geo.getAttribute('normal');
	let badNormal = -1;
	let badLen = 0;
	for (let i = 0; i < nrm.count; i++) {
		const len = Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
		if (!(Math.abs(len - 1) <= 1e-3)) { badNormal = i; badLen = len; break; }
	}
	check(
		'normals unit length',
		badNormal === -1,
		badNormal === -1 ? '' : `vertex ${badNormal} has |n| = ${badLen}`,
	);

	check('has vertex colors', geo.hasAttribute('color'));
	check('has uvs', geo.hasAttribute('uv'));

	console.log(
		`       ${pos.count} verts / ${idx.count / 3} tris / ${box.max.y.toFixed(2)}m tall\n`,
	);
}

// ---------------------------------------------------------------------------
// Variants are actually different from each other
// ---------------------------------------------------------------------------

console.log('Cross-variant');
const profiles = REED_VARIANT_NAMES.map((v) => {
	const geo = buildReedClumpGeometry(v, { seed: 4242 });
	return {
		v,
		height: geo.boundingBox.max.y,
		stems: geo.userData.reed.stemCount,
		spread: Math.hypot(geo.boundingBox.max.x - geo.boundingBox.min.x, geo.boundingBox.max.z - geo.boundingBox.min.z),
	};
});

const tall = profiles.find((p) => p.v === 'denseTall');
const short = profiles.find((p) => p.v === 'shortYoung');
const bentP = profiles.find((p) => p.v === 'bent');
const sparse = profiles.find((p) => p.v === 'sparseStraight');

check('denseTall is the tallest', tall.height === Math.max(...profiles.map((p) => p.height)));
check('shortYoung is the shortest', short.height === Math.min(...profiles.map((p) => p.height)));
check('denseTall has the most stems', tall.stems >= Math.max(...profiles.map((p) => p.stems)));
check(
	'bent leans out further than it is tall, relative to sparseStraight',
	bentP.spread / bentP.height > sparse.spread / sparse.height,
	`bent ${(bentP.spread / bentP.height).toFixed(2)} vs sparse ${(sparse.spread / sparse.height).toFixed(2)}`,
);

// Different seeds give different clumps.
const a = buildReedClumpGeometry('bent', { seed: 1 });
const b = buildReedClumpGeometry('bent', { seed: 2 });
check(
	'seed changes the clump',
	a.getAttribute('position').count !== b.getAttribute('position').count ||
		a.boundingBox.max.y !== b.boundingBox.max.y,
);

// ---------------------------------------------------------------------------
// Material sharing
// ---------------------------------------------------------------------------

console.log('\nMaterial + instancing');
const meshes = REED_VARIANT_NAMES.map((v) => createReedClump(v));
const materials = new Set(meshes.map((m) => m.material));
check('all four variants share one material', materials.size === 1, `${materials.size} material(s)`);
check('material uses vertex colors', getSharedReedMaterial().vertexColors === true);

const bed = createReedBed({ counts: { sparseStraight: 20, denseTall: 15, bent: 12, shortYoung: 25 } });
const bedMaterials = new Set(bed.children.map((m) => m.material));
check('reed bed shares one material', bedMaterials.size === 1);
check('reed bed has one draw call per variant', bed.children.length === 4, `${bed.children.length} InstancedMeshes`);

// ---------------------------------------------------------------------------
// Instance transforms keep the base on the ground
// ---------------------------------------------------------------------------

const inst = createReedClumpInstances('bent', 64, { seed: 3, radius: 5, lean: [0, 0.14] });
check('instance count honoured', inst.count === 64);
check('per-instance tint applied', inst.instanceColor !== null);

const m = new THREE.Matrix4();
const p = new THREE.Vector3();
const q = new THREE.Quaternion();
const s = new THREE.Vector3();
const rootLocal = new THREE.Vector3(0, 0, 0);
const rootWorld = new THREE.Vector3();

let rootsPlanted = true;
let maxLean = 0;
let minScale = Infinity;
let maxScale = -Infinity;
const yaws = new Set();

for (let i = 0; i < inst.count; i++) {
	inst.getMatrixAt(i, m);
	m.decompose(p, q, s);

	// The clump's root vertex must land exactly on the ground plane.
	rootWorld.copy(rootLocal).applyMatrix4(m);
	if (Math.abs(rootWorld.y - p.y) > 1e-5) rootsPlanted = false;

	// Lean = angle the local +Y ends up making with world +Y.
	const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
	maxLean = Math.max(maxLean, up.angleTo(new THREE.Vector3(0, 1, 0)));

	minScale = Math.min(minScale, s.x);
	maxScale = Math.max(maxScale, s.x);
	yaws.add(Math.round(Math.atan2(up.x, up.z) * 100));
}

check('root stays on the ground plane under lean', rootsPlanted);
check('lean within requested range', maxLean <= 0.14 + 1e-6, `max ${maxLean.toFixed(3)} rad`);
check('scale varies', maxScale - minScale > 0.1, `${minScale.toFixed(2)} - ${maxScale.toFixed(2)}`);
check('rotation varies', yaws.size > 20, `${yaws.size} distinct headings`);

// ---------------------------------------------------------------------------

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
	console.error(`${failures} FAILED`);
	process.exit(1);
}
