import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const declared = packageJson.dependencies?.["@ff-labs/fff-node"];
const locked = lock.packages?.["node_modules/@ff-labs/fff-node"]?.version;

if (declared !== "^0.9.6") {
	throw new Error(`@ff-labs/fff-node must use the reviewed compatibility range ^0.9.6, found ${String(declared)}`);
}
if (typeof locked !== "string" || !/^0\.9\.(?:[6-9]|[1-9]\d+)(?:-|$)/.test(locked)) {
	throw new Error(`package-lock.json resolves unsupported @ff-labs/fff-node version ${String(locked)}; expected >=0.9.6 <0.10.0`);
}
console.log(`Verified @ff-labs/fff-node ${locked} within ${declared}`);
