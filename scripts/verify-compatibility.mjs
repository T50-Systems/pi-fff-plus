import { readFileSync } from "node:fs";
import { parse } from "yaml";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const lock = parse(readFileSync(new URL("../pnpm-lock.yaml", import.meta.url), "utf8"));
const declared = packageJson.dependencies?.["@ff-labs/fff-node"];
const importer = lock.importers?.["."];
const locked = importer?.dependencies?.["@ff-labs/fff-node"]?.version;
if (lock.lockfileVersion !== "9.0" || importer?.dependencies?.["@ff-labs/fff-node"]?.specifier !== declared) {
	throw new Error("pnpm-lock.yaml must retain the root compatibility range and lockfile format 9.0");
}

if (declared !== "^0.9.6") {
	throw new Error(`@ff-labs/fff-node must use the reviewed compatibility range ^0.9.6, found ${String(declared)}`);
}
if (typeof locked !== "string" || !/^0\.9\.(?:[6-9]|[1-9]\d+)(?:-|$)/.test(locked)) {
	throw new Error(`pnpm-lock.yaml resolves unsupported @ff-labs/fff-node version ${String(locked)}; expected >=0.9.6 <0.10.0`);
}
console.log(`Verified @ff-labs/fff-node ${locked} within ${declared}`);
