/**
 * Procedural pond reed clumps for three.js.
 *
 * Four hand-tuned clump variants ("sparseStraight", "denseTall", "bent",
 * "shortYoung"), each built as a single merged, indexed BufferGeometry so a
 * clump can be pushed through an InstancedMesh and repeated thousands of times.
 *
 * Invariants every clump geometry satisfies (see scripts/verify.mjs):
 *   - the pivot (local origin) sits on the root of the centre stem,
 *   - the geometry's lowest vertex is exactly y = 0, so clumps drop straight
 *     onto a ground plane and lean about their base,
 *   - stalks are subdivided vertically (8-14 rings) so they can be bent by the
 *     generator, or displaced later by a vertex shader,
 *   - colour lives in a vertex-colour attribute, so every variant renders with
 *     one shared material.
 *
 * No bones, no skinning: bend is baked into the geometry.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const WORLD_UP = /*@__PURE__*/ new THREE.Vector3(0, 1, 0);
const FALLBACK_AXIS = /*@__PURE__*/ new THREE.Vector3(1, 0, 0);

/** A stalk never tilts past this angle from vertical, so tips stay above y=0. */
const MAX_TILT = 1.45;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32) so a given seed always rebuilds the same clump. */
export function makeRng(seed = 1) {
	let a = seed >>> 0;
	return function rng() {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * mergeGeometries returns null (after a console warning) when the inputs
 * disagree on attributes -- easy to hit when adding a new reed part that forgets
 * one. Fail loudly instead of handing back a null geometry.
 */
function mergeParts(parts, what) {
	const merged = mergeGeometries(parts);
	if (merged === null) {
		throw new Error(
			`Could not merge ${what}: parts must all be indexed and share the same attributes ` +
				'(position, normal, uv, color).',
		);
	}
	return merged;
}

const lerp = (a, b, t) => a + (b - a) * t;
const range = (rng, [min, max]) => lerp(min, max, rng());
const rangeInt = (rng, [min, max]) => min + Math.floor(rng() * (max - min + 1));

// ---------------------------------------------------------------------------
// Geometry primitives
// ---------------------------------------------------------------------------

/**
 * Sweep a tapered tube along a curve.
 *
 * `segments` is the vertical subdivision count -- the number of rings laid
 * along the curve. Normals are derived analytically from the radius slope
 * rather than averaged, so the duplicated UV seam does not show as a crease.
 *
 * @param {object} opts
 * @param {THREE.Curve} opts.curve         centreline, arc-length sampled
 * @param {number} opts.segments           rings along the curve
 * @param {number} opts.radialSegments     sides around the tube
 * @param {(t:number)=>number} opts.radiusAt
 * @param {(t:number,target:THREE.Color)=>void} opts.colorAt
 * @param {boolean} [opts.capStart]
 * @param {boolean} [opts.capEnd]
 * @returns {THREE.BufferGeometry}
 */
function sweepTube({
	curve,
	segments,
	radialSegments,
	radiusAt,
	colorAt,
	capStart = false,
	capEnd = false,
}) {
	const frames = curve.computeFrenetFrames(segments, false);
	const arcLength = Math.max(curve.getLength(), 1e-6);

	const positions = [];
	const normals = [];
	const colors = [];
	const uvs = [];
	const indices = [];

	const P = new THREE.Vector3();
	const T = new THREE.Vector3();
	const radial = new THREE.Vector3();
	const nrm = new THREE.Vector3();
	const col = new THREE.Color();

	const ringVerts = radialSegments + 1; // seam vertex duplicated for UVs
	const dt = 0.5 / segments;

	for (let i = 0; i <= segments; i++) {
		const t = i / segments;
		curve.getPointAt(t, P);
		T.copy(frames.tangents[i]);
		const N = frames.normals[i];
		const B = frames.binormals[i];

		const r = radiusAt(t);

		// dR/ds along the curve: tilts the shell normal so the taper is lit correctly.
		const t0 = Math.max(0, t - dt);
		const t1 = Math.min(1, t + dt);
		const dRds = (radiusAt(t1) - radiusAt(t0)) / ((t1 - t0) * arcLength);

		colorAt(t, col);

		for (let j = 0; j <= radialSegments; j++) {
			const theta = (j / radialSegments) * Math.PI * 2;
			const cos = Math.cos(theta);
			const sin = Math.sin(theta);

			radial.set(0, 0, 0).addScaledVector(N, cos).addScaledVector(B, sin);

			positions.push(P.x + radial.x * r, P.y + radial.y * r, P.z + radial.z * r);
			nrm.copy(radial).addScaledVector(T, -dRds).normalize();
			normals.push(nrm.x, nrm.y, nrm.z);
			colors.push(col.r, col.g, col.b);
			uvs.push(j / radialSegments, t);
		}
	}

	for (let i = 0; i < segments; i++) {
		for (let j = 0; j < radialSegments; j++) {
			const a = i * ringVerts + j;
			const b = a + ringVerts;
			const c = b + 1;
			const d = a + 1;
			// Wound so the shell faces outward (r-hat x theta-hat = tangent).
			indices.push(a, d, b, b, d, c);
		}
	}

	const addCap = (t, flip) => {
		curve.getPointAt(t, P);
		T.copy(frames.tangents[flip ? 0 : segments]);
		const N = frames.normals[flip ? 0 : segments];
		const B = frames.binormals[flip ? 0 : segments];
		const r = radiusAt(t);
		colorAt(t, col);

		const nx = flip ? -T.x : T.x;
		const ny = flip ? -T.y : T.y;
		const nz = flip ? -T.z : T.z;

		const center = positions.length / 3;
		positions.push(P.x, P.y, P.z);
		normals.push(nx, ny, nz);
		colors.push(col.r, col.g, col.b);
		uvs.push(0.5, 0.5);

		for (let j = 0; j <= radialSegments; j++) {
			const theta = (j / radialSegments) * Math.PI * 2;
			const cos = Math.cos(theta);
			const sin = Math.sin(theta);
			radial.set(0, 0, 0).addScaledVector(N, cos).addScaledVector(B, sin);
			positions.push(P.x + radial.x * r, P.y + radial.y * r, P.z + radial.z * r);
			normals.push(nx, ny, nz);
			colors.push(col.r, col.g, col.b);
			uvs.push(0.5 + cos * 0.5, 0.5 + sin * 0.5);
		}

		for (let j = 0; j < radialSegments; j++) {
			const v0 = center + 1 + j;
			const v1 = center + 1 + j + 1;
			if (flip) indices.push(center, v1, v0);
			else indices.push(center, v0, v1);
		}
	};

	if (capStart) addCap(0, true);
	if (capEnd) addCap(1, false);

	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
	geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
	geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
	geo.setIndex(indices);
	return geo;
}

/**
 * Sweep a folded ribbon along a curve -- used for leaf blades.
 * Three vertices per row (left / raised midrib / right).
 */
function sweepRibbon({ curve, segments, widthAt, foldAt, colorAt }) {
	const positions = [];
	const normals = [];
	const colors = [];
	const uvs = [];
	const indices = [];

	const P = new THREE.Vector3();
	const T = new THREE.Vector3();
	const side = new THREE.Vector3();
	const face = new THREE.Vector3();
	const nL = new THREE.Vector3();
	const nR = new THREE.Vector3();
	const col = new THREE.Color();

	for (let i = 0; i <= segments; i++) {
		const t = i / segments;
		curve.getPointAt(t, P);
		curve.getTangentAt(t, T);

		side.crossVectors(T, WORLD_UP);
		if (side.lengthSq() < 1e-8) side.crossVectors(T, FALLBACK_AXIS);
		side.normalize();
		face.crossVectors(side, T).normalize();

		const w = widthAt(t);
		const fold = foldAt(t) * w;
		colorAt(t, col);

		positions.push(P.x - side.x * w * 0.5, P.y - side.y * w * 0.5, P.z - side.z * w * 0.5);
		positions.push(P.x + face.x * fold, P.y + face.y * fold, P.z + face.z * fold);
		positions.push(P.x + side.x * w * 0.5, P.y + side.y * w * 0.5, P.z + side.z * w * 0.5);

		// Analytic normals for the two panels of the V. The tilt only depends on
		// the fold-to-halfwidth ratio, so it stays well defined where the blade
		// pinches to nothing at the base and tip -- computeVertexNormals would
		// hand back NaN on those degenerate rows.
		const k = 2 * foldAt(t);
		nL.copy(face).addScaledVector(side, -k).normalize();
		nR.copy(face).addScaledVector(side, k).normalize();

		normals.push(nL.x, nL.y, nL.z, face.x, face.y, face.z, nR.x, nR.y, nR.z);

		for (let k2 = 0; k2 < 3; k2++) {
			colors.push(col.r, col.g, col.b);
			uvs.push(k2 * 0.5, t);
		}
	}

	for (let i = 0; i < segments; i++) {
		const a = i * 3;
		const b = a + 3;
		indices.push(a, a + 1, b, a + 1, b + 1, b);
		indices.push(a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
	}

	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
	geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
	geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
	geo.setIndex(indices);
	return geo;
}

/**
 * Duplicate a geometry with reversed winding and flipped normals, so a
 * single-sided material still lights both faces of a blade. Keeps the whole
 * reed on one material instead of needing a DoubleSide variant.
 */
function makeDoubleSided(geo) {
	const back = geo.clone();
	const idx = back.getIndex().array;
	for (let i = 0; i < idx.length; i += 3) {
		const tmp = idx[i];
		idx[i] = idx[i + 2];
		idx[i + 2] = tmp;
	}
	const n = back.getAttribute('normal');
	for (let i = 0; i < n.count; i++) {
		n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
	}
	n.needsUpdate = true;
	return mergeParts([geo, back], 'blade front/back faces');
}

// ---------------------------------------------------------------------------
// Stalk centreline
// ---------------------------------------------------------------------------

/**
 * Integrate a stalk centreline starting at the origin.
 *
 * The tilt from vertical grows with height (`lean + bend * t^bendPower`), which
 * is roughly how a cantilevered reed sags under its own weight: near-straight at
 * the base, curving hardest near the tip. Integrating a fixed step keeps the
 * arc length equal to `length` no matter how hard it bends.
 */
function integrateStalk({
	length,
	azimuth,
	azimuthDrift = 0,
	lean,
	bend,
	bendPower,
	steps = 14,
	origin = null,
}) {
	const pts = [];
	const p = origin ? origin.clone() : new THREE.Vector3();
	pts.push(p.clone());

	const step = length / steps;
	for (let i = 1; i <= steps; i++) {
		const t = (i - 0.5) / steps; // midpoint rule
		const theta = Math.min(lean + bend * Math.pow(t, bendPower), MAX_TILT);
		const phi = azimuth + azimuthDrift * t;
		const s = Math.sin(theta);
		p.x += Math.cos(phi) * s * step;
		p.z += Math.sin(phi) * s * step;
		p.y += Math.cos(theta) * step;
		pts.push(p.clone());
	}
	return pts;
}

const curveThrough = (pts) => new THREE.CatmullRomCurve3(pts, false, 'centripetal');

// ---------------------------------------------------------------------------
// Variant definitions
// ---------------------------------------------------------------------------

const c = (hex) => new THREE.Color(hex);

/**
 * Per-variant tuning. Every numeric pair is a [min, max] range sampled per stem,
 * so repeated instantiation of the same variant with different seeds still gives
 * distinguishable clumps.
 */
export const REED_VARIANTS = {
	sparseStraight: {
		label: 'Sparse Straight',
		description: 'A few well-spaced, near-vertical stems. Reads as open water edge.',
		stemCount: [4, 6],
		clumpRadius: 0.3,
		spreadPower: 0.55, // <1 pushes stems outward, >1 pulls them to the centre
		height: [1.45, 2.0],
		baseRadius: [0.011, 0.015],
		tipRatio: 0.3,
		lean: [0.02, 0.1],
		bend: [0.05, 0.18],
		bendPower: 2.0,
		azimuthDrift: [-0.3, 0.3],
		segments: 10,
		radialSegments: 6,
		blades: [1, 2],
		bladeLength: [0.3, 0.45],
		seedHeadChance: 0.25,
		stemBase: c(0x3d5a2a),
		stemTip: c(0x6f8f3f),
		blade: c(0x4e7130),
	},
	denseTall: {
		label: 'Dense Tall',
		description: 'Packed mature stand, tallest of the set, most with seed heads.',
		stemCount: [8, 10],
		clumpRadius: 0.22,
		spreadPower: 0.8,
		height: [2.1, 2.9],
		baseRadius: [0.013, 0.019],
		tipRatio: 0.28,
		lean: [0.01, 0.07],
		bend: [0.06, 0.22],
		bendPower: 2.2,
		azimuthDrift: [-0.25, 0.25],
		segments: 12,
		radialSegments: 6,
		blades: [2, 3],
		bladeLength: [0.35, 0.55],
		seedHeadChance: 0.7,
		stemBase: c(0x2f4a22),
		stemTip: c(0x5c8036),
		blade: c(0x3c5f28),
	},
	bent: {
		label: 'Bent',
		description: 'Wind- or weather-laid stems arcing hard toward one heading.',
		stemCount: [5, 7],
		clumpRadius: 0.34,
		spreadPower: 0.6,
		height: [1.6, 2.3],
		baseRadius: [0.012, 0.018],
		tipRatio: 0.3,
		lean: [0.1, 0.3],
		bend: [0.55, 1.15],
		bendPower: 1.5,
		azimuthDrift: [-0.5, 0.5],
		azimuthSpread: 0.7, // stems share a prevailing heading rather than fanning out
		segments: 14,
		radialSegments: 6,
		blades: [2, 3],
		bladeLength: [0.3, 0.5],
		seedHeadChance: 0.45,
		stemBase: c(0x4a5a2a),
		stemTip: c(0x8a9146),
		blade: c(0x6b7434),
	},
	shortYoung: {
		label: 'Short Young',
		description: 'New growth: short, thin, bright, upright, no seed heads yet.',
		stemCount: [5, 8],
		clumpRadius: 0.16,
		spreadPower: 0.7,
		height: [0.45, 0.85],
		baseRadius: [0.006, 0.01],
		tipRatio: 0.22,
		lean: [0.03, 0.14],
		bend: [0.1, 0.3],
		bendPower: 1.8,
		azimuthDrift: [-0.4, 0.4],
		segments: 8,
		radialSegments: 5,
		blades: [1, 2],
		bladeLength: [0.16, 0.28],
		seedHeadChance: 0,
		stemBase: c(0x4a7a2e),
		stemTip: c(0x8fc04d),
		blade: c(0x5f9a35),
	},
};

/** Variant keys, in a stable presentation order. */
export const REED_VARIANT_NAMES = Object.keys(REED_VARIANTS);

const SEED_HEAD_BASE = /*@__PURE__*/ c(0x8a6f45);
const SEED_HEAD_TIP = /*@__PURE__*/ c(0xc0a271);

// ---------------------------------------------------------------------------
// Shared material
// ---------------------------------------------------------------------------

let sharedMaterial = null;

/**
 * The one material every variant renders with. Colour comes from the baked
 * vertex-colour attribute, so stems, blades and seed heads differ in appearance
 * without needing separate materials or draw calls.
 */
export function getSharedReedMaterial(overrides) {
	if (sharedMaterial === null) {
		sharedMaterial = new THREE.MeshStandardMaterial({
			name: 'reed',
			vertexColors: true,
			roughness: 0.78,
			metalness: 0.0,
		});
	}
	if (overrides) sharedMaterial.setValues(overrides);
	return sharedMaterial;
}

/** Drop the cached material (tests, hot reload). */
export function disposeSharedReedMaterial() {
	if (sharedMaterial) sharedMaterial.dispose();
	sharedMaterial = null;
}

// ---------------------------------------------------------------------------
// Clump assembly
// ---------------------------------------------------------------------------

/** Golden-angle disc placement: even, non-lattice spread of stem roots. */
function stemRootOffsets(count, radius, spreadPower, rng) {
	const golden = Math.PI * (3 - Math.sqrt(5));
	const offsets = [];
	for (let i = 0; i < count; i++) {
		if (i === 0) {
			// Anchor one stem on the pivot so the origin is literally a root.
			offsets.push(new THREE.Vector2(0, 0));
			continue;
		}
		const f = Math.pow(i / (count - 1), spreadPower);
		const r = f * radius * lerp(0.75, 1.0, rng());
		const a = i * golden + rng() * 0.4;
		offsets.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
	}
	return offsets;
}

function buildStem(def, rng, root, prevailingAzimuth) {
	const parts = [];

	const height = range(rng, def.height);
	const baseRadius = range(rng, def.baseRadius);
	const tipRadius = baseRadius * def.tipRatio;

	// "bent" clumps mostly agree on a heading; the others fan freely.
	const spread = def.azimuthSpread ?? 1;
	const azimuth =
		prevailingAzimuth + (rng() - 0.5) * Math.PI * 2 * spread;

	const lean = range(rng, def.lean);
	const bend = range(rng, def.bend);

	const stalkPoints = integrateStalk({
		length: height,
		azimuth,
		azimuthDrift: range(rng, def.azimuthDrift),
		lean,
		bend,
		bendPower: def.bendPower,
		origin: root,
	});
	const stalk = curveThrough(stalkPoints);

	// Reeds swell slightly above the waterline before tapering, hence the
	// non-linear radius profile rather than a straight lerp.
	parts.push(
		sweepTube({
			curve: stalk,
			segments: def.segments,
			radialSegments: def.radialSegments,
			radiusAt: (t) => lerp(baseRadius, tipRadius, Math.pow(t, 0.7)),
			colorAt: (t, target) => {
				target.copy(def.stemBase).lerp(def.stemTip, Math.pow(t, 0.8));
			},
			capStart: true,
			capEnd: true,
		}),
	);

	// --- leaf blades -------------------------------------------------------
	const bladeCount = rangeInt(rng, def.blades);
	for (let b = 0; b < bladeCount; b++) {
		const t0 = lerp(0.12, 0.55, rng());
		const anchor = stalk.getPointAt(t0);
		const bladeLength = range(rng, def.bladeLength) * (height / 2);
		const bladeWidth = baseRadius * lerp(2.4, 3.6, rng());

		const bladePoints = integrateStalk({
			length: Math.max(bladeLength, 0.05),
			azimuth: azimuth + (rng() - 0.5) * Math.PI * 2,
			azimuthDrift: (rng() - 0.5) * 0.6,
			lean: lerp(0.5, 0.9, rng()), // leaves already off vertical where they emerge
			bend: lerp(0.7, 1.4, rng()), // then arc over and droop
			bendPower: 1.3,
			steps: 8,
			origin: anchor,
		});

		const blade = sweepRibbon({
			curve: curveThrough(bladePoints),
			segments: 8,
			widthAt: (t) => bladeWidth * Math.sin(Math.pow(t, 0.45) * Math.PI) ** 0.7,
			foldAt: () => 0.22,
			colorAt: (t, target) => {
				target.copy(def.blade).lerp(def.stemTip, t * 0.35);
			},
		});
		parts.push(makeDoubleSided(blade));
	}

	// --- seed head ---------------------------------------------------------
	if (rng() < def.seedHeadChance) {
		const headLength = height * lerp(0.12, 0.19, rng());
		const headRadius = baseRadius * lerp(1.5, 2.1, rng());
		const tipT = 0.995;

		const headPoints = integrateStalk({
			length: headLength,
			azimuth,
			lean: Math.min(lean + bend, MAX_TILT), // continue the stalk's tip heading
			bend: 0.12,
			bendPower: 1,
			steps: 6,
			origin: stalk.getPointAt(tipT),
		});

		parts.push(
			sweepTube({
				curve: curveThrough(headPoints),
				segments: 8,
				radialSegments: def.radialSegments,
				// Spindle: pinched at both ends, fattest just past the middle.
				radiusAt: (t) =>
					Math.max(tipRadius * 0.6, headRadius * Math.sin(Math.pow(t, 0.8) * Math.PI) ** 0.75),
				colorAt: (t, target) => {
					target.copy(SEED_HEAD_BASE).lerp(SEED_HEAD_TIP, t);
				},
				capStart: false,
				capEnd: false,
			}),
		);
	}

	return parts;
}

/**
 * Build one clump variant as a single merged geometry.
 *
 * @param {keyof typeof REED_VARIANTS} variant
 * @param {object} [options]
 * @param {number} [options.seed]      changes stem count / bend / height within the variant's ranges
 * @param {object} [options.overrides] shallow-merged over the variant definition
 * @returns {THREE.BufferGeometry} pivot at the root, lowest vertex at y = 0
 */
export function buildReedClumpGeometry(variant, options = {}) {
	const base = REED_VARIANTS[variant];
	if (!base) {
		throw new Error(
			`Unknown reed variant "${variant}". Expected one of: ${REED_VARIANT_NAMES.join(', ')}`,
		);
	}
	const def = options.overrides ? { ...base, ...options.overrides } : base;
	const rng = makeRng(options.seed ?? 1337);

	const stemCount = rangeInt(rng, def.stemCount);
	const roots = stemRootOffsets(stemCount, def.clumpRadius, def.spreadPower, rng);
	const prevailingAzimuth = rng() * Math.PI * 2;

	const parts = [];
	const root = new THREE.Vector3();
	for (let i = 0; i < stemCount; i++) {
		root.set(roots[i].x, 0, roots[i].y);
		parts.push(...buildStem(def, rng, root, prevailingAzimuth));
	}

	const merged = mergeParts(parts, `reed clump "${variant}"`);
	for (const part of parts) part.dispose();

	// Every stalk starts at y = 0, but a leaning base cap ring dips a fraction of
	// a millimetre below it. Clamp so "base at y = 0" holds exactly; the affected
	// ring is underground.
	const pos = merged.getAttribute('position');
	for (let i = 0; i < pos.count; i++) {
		if (pos.getY(i) < 0) pos.setY(i, 0);
	}

	merged.computeBoundingBox();
	merged.computeBoundingSphere();
	merged.name = `reed-clump-${variant}`;
	merged.userData.reed = { variant, seed: options.seed ?? 1337, stemCount };
	return merged;
}

/** Cache of geometries keyed by `variant:seed`, so repeat calls reuse buffers. */
const geometryCache = new Map();

/** Build (or fetch) the clump geometry for a variant + seed. */
export function getReedClumpGeometry(variant, seed = 1337) {
	const key = `${variant}:${seed}`;
	let geo = geometryCache.get(key);
	if (!geo) {
		geo = buildReedClumpGeometry(variant, { seed });
		geometryCache.set(key, geo);
	}
	return geo;
}

/** Free every cached clump geometry. */
export function disposeReedGeometryCache() {
	for (const geo of geometryCache.values()) geo.dispose();
	geometryCache.clear();
}

/**
 * A single clump as a Mesh. Useful for inspecting a variant; for many copies
 * use `createReedClumpInstances`.
 */
export function createReedClump(variant, options = {}) {
	const geo = options.seed === undefined
		? getReedClumpGeometry(variant)
		: getReedClumpGeometry(variant, options.seed);
	const mesh = new THREE.Mesh(geo, options.material ?? getSharedReedMaterial());
	mesh.name = `reed-${variant}`;
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	return mesh;
}

// ---------------------------------------------------------------------------
// Instancing
// ---------------------------------------------------------------------------

const _pos = /*@__PURE__*/ new THREE.Vector3();
const _scl = /*@__PURE__*/ new THREE.Vector3();
const _axis = /*@__PURE__*/ new THREE.Vector3();
const _qLean = /*@__PURE__*/ new THREE.Quaternion();
const _qYaw = /*@__PURE__*/ new THREE.Quaternion();
const _mat = /*@__PURE__*/ new THREE.Matrix4();
const _tint = /*@__PURE__*/ new THREE.Color();

/** Default placement: uniform over a disc of `radius` centred on the origin. discs sample sqrt(u) for even area density. */
function discPlacement(radius) {
	return (rng, target) => {
		const a = rng() * Math.PI * 2;
		const r = Math.sqrt(rng()) * radius;
		return target.set(Math.cos(a) * r, 0, Math.sin(a) * r);
	};
}

/**
 * Scatter one clump variant as an InstancedMesh, each copy with its own yaw,
 * scale and lean.
 *
 * Because the pivot is at the root, the lean rotation happens about the base:
 * the clump tips over without lifting out of, or sinking into, the ground.
 *
 * @param {keyof typeof REED_VARIANTS} variant
 * @param {number} count
 * @param {object} [options]
 * @param {number} [options.seed]
 * @param {number} [options.geometrySeed]  seed for the clump shape itself
 * @param {number} [options.radius]        disc radius for the default placement
 * @param {(rng:Function, target:THREE.Vector3)=>THREE.Vector3} [options.placement]
 * @param {[number,number]} [options.scale]      uniform scale range
 * @param {[number,number]} [options.heightScale] extra vertical stretch
 * @param {[number,number]} [options.lean]       lean range in radians
 * @param {number} [options.tint]          per-instance brightness jitter, 0 disables
 * @param {THREE.Material} [options.material]
 * @returns {THREE.InstancedMesh}
 */
export function createReedClumpInstances(variant, count, options = {}) {
	const {
		seed = 7,
		geometrySeed,
		radius = 6,
		placement = discPlacement(radius),
		scale = [0.75, 1.3],
		heightScale = [0.9, 1.15],
		lean = [0, 0.14],
		tint = 0.12,
		material = getSharedReedMaterial(),
	} = options;

	const geometry =
		options.geometry ??
		(geometrySeed === undefined
			? getReedClumpGeometry(variant)
			: getReedClumpGeometry(variant, geometrySeed));

	const mesh = new THREE.InstancedMesh(geometry, material, count);
	mesh.name = `reeds-${variant}-x${count}`;
	mesh.castShadow = true;
	mesh.receiveShadow = true;

	const rng = makeRng(seed);

	for (let i = 0; i < count; i++) {
		placement(rng, _pos);

		const s = range(rng, scale);
		_scl.set(s, s * range(rng, heightScale), s);

		const yaw = rng() * Math.PI * 2;
		const leanAngle = range(rng, lean);
		const leanAzimuth = rng() * Math.PI * 2;

		_axis.set(Math.cos(leanAzimuth), 0, Math.sin(leanAzimuth));
		_qLean.setFromAxisAngle(_axis, leanAngle);
		_qYaw.setFromAxisAngle(WORLD_UP, yaw);
		// Yaw first (spins the clump about its own axis), then tip it over.
		_qLean.multiply(_qYaw);

		_mat.compose(_pos, _qLean, _scl);
		mesh.setMatrixAt(i, _mat);

		if (tint > 0) {
			const k = 1 + (rng() - 0.5) * 2 * tint;
			_tint.setRGB(k, k * (1 + (rng() - 0.5) * tint * 0.5), k);
			mesh.setColorAt(i, _tint);
		}
	}

	mesh.instanceMatrix.needsUpdate = true;
	if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
	mesh.computeBoundingSphere();
	return mesh;
}

/**
 * A whole reed bed: all four variants scattered together, sharing one material.
 *
 * @param {object} [options]
 * @param {Partial<Record<keyof typeof REED_VARIANTS, number>>} [options.counts]
 * @param {number} [options.seed]
 * @param {number} [options.radius]
 * @param {(rng:Function, target:THREE.Vector3)=>THREE.Vector3} [options.placement]
 * @returns {THREE.Group} one InstancedMesh child per variant
 */
export function createReedBed(options = {}) {
	const {
		counts = { sparseStraight: 120, denseTall: 90, bent: 70, shortYoung: 160 },
		seed = 11,
		radius = 8,
		placement,
		material = getSharedReedMaterial(),
	} = options;

	const group = new THREE.Group();
	group.name = 'reed-bed';

	REED_VARIANT_NAMES.forEach((variant, i) => {
		const count = counts[variant] ?? 0;
		if (count <= 0) return;
		group.add(
			createReedClumpInstances(variant, count, {
				seed: seed + i * 977,
				radius,
				placement,
				material,
				...(options.variantOptions?.[variant] ?? {}),
			}),
		);
	});

	return group;
}
