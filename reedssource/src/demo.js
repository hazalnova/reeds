/**
 * Demo scene: a pond ringed with instanced reed beds, plus a specimen row
 * showing one clump of each variant side by side.
 *
 * Everything reed-shaped comes from src/reeds.js and shares a single material,
 * so the whole bed is four draw calls (one InstancedMesh per variant).
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import {
	REED_VARIANTS,
	REED_VARIANT_NAMES,
	createReedClump,
	createReedClumpInstances,
	getSharedReedMaterial,
} from './reeds.js';

const POND_RADIUS = 9;

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9dbcc8);
scene.fog = new THREE.Fog(0x9dbcc8, 26, 78);

const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 300);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI * 0.495; // stay above the waterline
controls.minDistance = 2;
controls.maxDistance = 60;

// ---------------------------------------------------------------------------
// Light
// ---------------------------------------------------------------------------

scene.add(new THREE.HemisphereLight(0xbcd8e8, 0x4a4426, 1.15));

const sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
sun.position.set(14, 18, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 60;
sun.shadow.camera.left = -22;
sun.shadow.camera.right = 22;
sun.shadow.camera.top = 22;
sun.shadow.camera.bottom = -22;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(sun.target);

// ---------------------------------------------------------------------------
// Ground and water
// ---------------------------------------------------------------------------

const bank = new THREE.Mesh(
	new THREE.CircleGeometry(60, 64).rotateX(-Math.PI / 2),
	new THREE.MeshStandardMaterial({ color: 0x53512f, roughness: 1 }),
);
bank.receiveShadow = true;
scene.add(bank);

// Shallow water sits just above the mud, so reed bases (y = 0) break the surface.
const water = new THREE.Mesh(
	new THREE.CircleGeometry(POND_RADIUS + 1.5, 96).rotateX(-Math.PI / 2),
	new THREE.MeshStandardMaterial({
		color: 0x24504c,
		roughness: 0.34,
		metalness: 0.08,
		transparent: true,
		opacity: 0.92,
	}),
);
water.position.y = 0.06;
water.receiveShadow = true;
scene.add(water);

// ---------------------------------------------------------------------------
// Reed beds
// ---------------------------------------------------------------------------

const reedMaterial = getSharedReedMaterial();

/** Even-area placement in an annulus, so clumps hug the pond edge. */
function ringPlacement(inner, outer) {
	return (rng, target) => {
		const a = rng() * Math.PI * 2;
		const r = Math.sqrt(inner * inner + rng() * (outer * outer - inner * inner));
		return target.set(Math.cos(a) * r, 0, Math.sin(a) * r);
	};
}

const beds = new THREE.Group();
beds.name = 'reed-beds';

// Each variant occupies the band where it makes sense: young growth wades out
// into the shallows, mature stands hold the waterline, sparse stems trail off
// onto the bank.
const BANDS = {
	shortYoung: { count: 190, band: [POND_RADIUS - 3.4, POND_RADIUS + 0.2], seed: 101 },
	denseTall: { count: 110, band: [POND_RADIUS - 0.6, POND_RADIUS + 1.6], seed: 202 },
	bent: { count: 80, band: [POND_RADIUS - 1.2, POND_RADIUS + 2.2], seed: 303 },
	sparseStraight: { count: 130, band: [POND_RADIUS + 0.4, POND_RADIUS + 5.5], seed: 404 },
};

for (const variant of REED_VARIANT_NAMES) {
	const { count, band, seed } = BANDS[variant];
	beds.add(
		createReedClumpInstances(variant, count, {
			seed,
			material: reedMaterial,
			placement: ringPlacement(band[0], band[1]),
			scale: [0.7, 1.35],
			heightScale: [0.88, 1.18],
			lean: [0, variant === 'bent' ? 0.2 : 0.12],
		}),
	);
}
scene.add(beds);

// ---------------------------------------------------------------------------
// Specimen row: one clump per variant, plus a label
// ---------------------------------------------------------------------------

const SPECIMEN_Z = -POND_RADIUS - 14;
const SPECIMEN_SPACING = 2.2;

function makeLabel(text, sub) {
	const canvas = document.createElement('canvas');
	canvas.width = 512;
	canvas.height = 128;
	const ctx = canvas.getContext('2d');
	ctx.fillStyle = 'rgba(8, 18, 14, 0.72)';
	ctx.roundRect(0, 0, 512, 128, 20);
	ctx.fill();
	ctx.textAlign = 'center';
	ctx.fillStyle = '#e6f4d8';
	ctx.font = '600 46px ui-sans-serif, system-ui, sans-serif';
	ctx.fillText(text, 256, 62);
	ctx.fillStyle = '#93ad88';
	ctx.font = '30px ui-sans-serif, system-ui, sans-serif';
	ctx.fillText(sub, 256, 102);

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

	const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture }));
	sprite.scale.set(1.6, 0.4, 1);
	return sprite;
}

const specimens = new THREE.Group();
specimens.name = 'specimens';

const pedestalGeometry = new THREE.CylinderGeometry(0.62, 0.7, 0.12, 32);
const pedestalMaterial = new THREE.MeshStandardMaterial({ color: 0x3f4a2c, roughness: 0.95 });

REED_VARIANT_NAMES.forEach((variant, i) => {
	const def = REED_VARIANTS[variant];
	const x = (i - (REED_VARIANT_NAMES.length - 1) / 2) * SPECIMEN_SPACING;

	const clump = createReedClump(variant, { material: reedMaterial });
	clump.position.set(x, 0, SPECIMEN_Z);
	specimens.add(clump);

	const pedestal = new THREE.Mesh(pedestalGeometry, pedestalMaterial);
	pedestal.position.set(x, 0.06, SPECIMEN_Z);
	pedestal.receiveShadow = true;
	specimens.add(pedestal);

	// In front of the pedestal so the clump itself never occludes the caption.
	const label = makeLabel(def.label, `${clump.geometry.userData.reed.stemCount} stems`);
	label.position.set(x, 0.3, SPECIMEN_Z + 0.9);
	specimens.add(label);
});

scene.add(specimens);

// A patch of loose clumps behind the specimens, to show the same four variants
// reading as a natural stand once randomised.
const loose = new THREE.Group();
REED_VARIANT_NAMES.forEach((variant, i) => {
	loose.add(
		createReedClumpInstances(variant, 22, {
			seed: 900 + i,
			material: reedMaterial,
			placement: (rng, target) =>
				target.set((rng() - 0.5) * 15, 0, SPECIMEN_Z - 4 - rng() * 6),
			scale: [0.7, 1.25],
			lean: [0, 0.16],
		}),
	);
});
scene.add(loose);

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

const VIEWS = {
	pond: { position: new THREE.Vector3(11, 4.6, 15), target: new THREE.Vector3(0, 1.2, 0) },
	specimens: {
		position: new THREE.Vector3(0, 1.7, SPECIMEN_Z + 6),
		target: new THREE.Vector3(0, 1.1, SPECIMEN_Z),
	},
};

const buttons = {
	pond: document.getElementById('view-pond'),
	specimens: document.getElementById('view-specimens'),
};

function setView(name, instant = false) {
	const view = VIEWS[name];
	for (const [key, button] of Object.entries(buttons)) {
		button.setAttribute('aria-pressed', String(key === name));
	}
	if (instant) {
		camera.position.copy(view.position);
		controls.target.copy(view.target);
		controls.update();
		return;
	}
	tween = { from: camera.position.clone(), fromTarget: controls.target.clone(), view, t: 0 };
}

let tween = null;
for (const [name, button] of Object.entries(buttons)) {
	button.addEventListener('click', () => setView(name));
}
setView('pond', true);

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

let triangles = 0;
let clumpInstances = 0;
scene.traverse((object) => {
	if (!object.isMesh || !object.geometry?.index) return;
	const perCopy = object.geometry.index.count / 3;
	const copies = object.isInstancedMesh ? object.count : 1;
	if (object.material === reedMaterial) {
		triangles += perCopy * copies;
		clumpInstances += copies;
	}
});

document.getElementById('stats').innerHTML = [
	`<b>${clumpInstances.toLocaleString()}</b> clumps instanced`,
	`<b>${Math.round(triangles).toLocaleString()}</b> reed triangles`,
	`<b>${REED_VARIANT_NAMES.length + 1}</b> reed draw calls, <b>1</b> material`,
].join('<br>');

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const TWEEN_SECONDS = 1.1;
const timer = new THREE.Timer();

renderer.setAnimationLoop(() => {
	// Drive the tween off wall-clock time, not frame count: on a slow GPU a
	// per-frame step would stretch the move out over many seconds.
	timer.update();
	const dt = Math.min(timer.getDelta(), 0.1);

	if (tween) {
		tween.t = Math.min(tween.t + dt / TWEEN_SECONDS, 1);
		const k = easeInOut(tween.t);
		camera.position.lerpVectors(tween.from, tween.view.position, k);
		controls.target.lerpVectors(tween.fromTarget, tween.view.target, k);
		if (tween.t >= 1) tween = null;
	}

	controls.update();
	renderer.render(scene, camera);
});

// Handy from the devtools console, and used by scripts/screenshot.mjs to frame
// specific clumps.
globalThis.demo = { scene, camera, controls, renderer, beds, specimens, SPECIMEN_Z, SPECIMEN_SPACING };

addEventListener('resize', () => {
	camera.aspect = innerWidth / innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(innerWidth, innerHeight);
});
