/**
 * Screenshot the running demo (dev server must already be up).
 *
 *   npm run dev
 *   node scripts/screenshot.mjs [outDir] [baseUrl]
 */

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const outDir = process.argv[2] ?? 'shots';
const baseUrl = process.argv[3] ?? 'http://127.0.0.1:5173/';

await mkdir(outDir, { recursive: true });

// Use a preinstalled Chromium when the environment pins one whose build number
// does not match this Playwright release.
const PINNED = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'];
const executablePath = PINNED.find((p) => existsSync(p));

const browser = await chromium.launch({
	...(executablePath ? { executablePath } : {}),
	args: [
		'--use-gl=angle',
		'--use-angle=swiftshader',
		'--enable-unsafe-swiftshader',
		'--ignore-gpu-blocklist',
	],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const problems = [];
page.on('console', (msg) => {
	if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`${msg.type()}: ${msg.text()}`);
});
page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));

await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);

const stats = await page.locator('#stats').innerText();
console.log(stats.replace(/\n/g, ' | '));

const shots = [
	['pond', '#view-pond'],
	['specimens', '#view-specimens'],
];

for (const [name, selector] of shots) {
	await page.click(selector);
	await page.waitForTimeout(9000); // software GL is slow; let the camera tween land
	await page.screenshot({ path: `${outDir}/${name}.png` });
	console.log(`wrote ${outDir}/${name}.png`);
}

// Close-up of a single variant, to check the silhouette of one clump.
for (const [name, index] of [['closeup-bent', 2], ['closeup-dense-tall', 1]]) {
	await page.evaluate((i) => {
		const { camera, controls, SPECIMEN_Z, SPECIMEN_SPACING } = globalThis.demo;
		const x = (i - 1.5) * SPECIMEN_SPACING;
		camera.position.set(x + 1.1, 1.15, SPECIMEN_Z + 2.9);
		controls.target.set(x, 1.0, SPECIMEN_Z);
		controls.update();
	}, index);
	await page.waitForTimeout(2500);
	await page.screenshot({ path: `${outDir}/${name}.png` });
	console.log(`wrote ${outDir}/${name}.png`);
}

if (problems.length) {
	console.log('\nconsole output:');
	for (const p of problems) console.log(`  ${p}`);
}

await browser.close();
