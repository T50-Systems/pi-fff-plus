import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { FileFinder } from "@ff-labs/fff-node";

const repositoryRoot = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1)));
const buildRoot = path.join(repositoryRoot, ".benchmark-dist");
const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "pi-fff-plus-bench-"));
const manifest = {
	version: 1,
	files: { typescript: 80, markdown: 40, json: 20, ignored: 20 },
	bytesPerFile: { small: 512, medium: 4096, large: 32768 },
	seed: "pi-fff-plus-fixed-v1",
};

function percentile(values, fraction) {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function summary(values) {
	return {
		samples: values.length,
		p50Ms: Number(percentile(values, 0.5).toFixed(4)),
		p95Ms: Number(percentile(values, 0.95).toFixed(4)),
		p99Ms: Number(percentile(values, 0.99).toFixed(4)),
		maxMs: Number(Math.max(...values).toFixed(4)),
	};
}

function makeContent(index, size, extension) {
	const header = extension === "ts"
		? `export const fixture${index} = "fixedNeedle-${index % 7}";\n`
		: `fixedNeedle-${index % 7} fixture-${index}\n`;
	return (header + "deterministic fixture content\n".repeat(Math.ceil(size / 30))).slice(0, size);
}

function createFixture() {
	const groups = [
		["src", "ts", manifest.files.typescript],
		["docs", "md", manifest.files.markdown],
		["data", "json", manifest.files.json],
		["node_modules/ignored", "js", manifest.files.ignored],
	];
	for (const [directory, extension, count] of groups) {
		const target = path.join(fixtureRoot, directory);
		mkdirSync(target, { recursive: true });
		for (let index = 0; index < count; index++) {
			const size = index % 12 === 0 ? 32768 : index % 3 === 0 ? 4096 : 512;
			writeFileSync(path.join(target, `fixture-${String(index).padStart(3, "0")}.${extension}`), makeContent(index, size, extension));
		}
	}
}

async function createFinder() {
	const created = FileFinder.create({ basePath: fixtureRoot, aiMode: true });
	if (!created.ok) throw new Error(created.error);
	const ready = await created.value.waitForScan(30_000);
	if (!ready.ok) {
		created.value.destroy();
		throw new Error(ready.error);
	}
	return created.value;
}

async function measure(samples, operation) {
	const values = [];
	let peakRssBytes = process.memoryUsage().rss;
	for (let index = 0; index < samples; index++) {
		const started = performance.now();
		await operation(index);
		values.push(performance.now() - started);
		peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
	}
	return { ...summary(values), peakRssBytes };
}

createFixture();
let finder;
try {
	rmSync(buildRoot, { recursive: true, force: true });
	execFileSync(process.execPath, [path.join(repositoryRoot, "node_modules", "typescript", "bin", "tsc"), "--outDir", buildRoot, "--noEmit", "false", "--declaration", "false"], { cwd: repositoryRoot, stdio: "ignore" });
	const { RootAuthorization } = await import(pathToFileURL(path.join(buildRoot, "root-authorization.js")));
	const { formatGrepOutput } = await import(pathToFileURL(path.join(buildRoot, "tools.js")));
	const coldIndex = await measure(5, async () => {
		const cold = await createFinder();
		cold.destroy();
	});
	finder = await createFinder();
	const exactGrep = await measure(40, () => {
		const result = finder.grep("fixedNeedle-3", { mode: "plain", pageSize: 50, maxMatchesPerFile: 5 });
		if (!result.ok) throw new Error(result.error);
	});
	const fuzzyFallback = await measure(40, () => {
		const exact = finder.grep("fizedNeedl-3", { mode: "plain", pageSize: 50 });
		if (!exact.ok) throw new Error(exact.error);
		const fuzzy = finder.grep("fizedNeedl-3", { mode: "fuzzy", pageSize: 50 });
		if (!fuzzy.ok) throw new Error(fuzzy.error);
	});
	const fileSearch = await measure(40, () => {
		const result = finder.fileSearch("fixture-042.ts", { pageIndex: 0, pageSize: 30 });
		if (!result.ok) throw new Error(result.error);
	});
	const authorization = new RootAuthorization({ cwd: fixtureRoot, extraRoots: [] });
	const authorizationOverhead = await measure(1_000, () => authorization.resolve("src/**/*.ts"));
	const grepForFormat = finder.grep("fixedNeedle", { mode: "plain", pageSize: 50, maxMatchesPerFile: 5 });
	if (!grepForFormat.ok) throw new Error(grepForFormat.error);
	const formattingOverhead = await measure(200, () => formatGrepOutput(grepForFormat.value, fixtureRoot, fixtureRoot, 50));
	const dependencyVersion = JSON.parse(readFileSync(path.join(repositoryRoot, "node_modules", "@ff-labs", "fff-node", "package.json"), "utf8")).version;
	const report = {
		benchmark: "pi-fff-plus fixed fixture v1",
		timestamp: new Date().toISOString(),
		runtime: { node: process.version, os: `${os.platform()} ${os.release()} ${os.arch()}`, dependency: `@ff-labs/fff-node@${dependencyVersion}` },
		fixture: manifest,
		budgets: { enforcement: "informational", ciRegressionThresholds: null },
		upstream: { coldIndex, warmExactGrep: exactGrep, warmFuzzyFallback: fuzzyFallback, warmFileSearch: fileSearch },
		extensionOwned: { authorization: authorizationOverhead, formatting: formattingOverhead },
	};
	console.log(JSON.stringify(report, null, 2));
} finally {
	finder?.destroy();
	rmSync(fixtureRoot, { recursive: true, force: true });
	rmSync(buildRoot, { recursive: true, force: true });
}
