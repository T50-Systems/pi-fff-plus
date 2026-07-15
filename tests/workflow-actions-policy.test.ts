import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	loadActionPolicy,
	validateRepository,
	validateWorkflowSource,
} from "../scripts/verify-workflow-actions.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const policy = loadActionPolicy(path.join(root, ".github", "actions-pins.json"));

function fixture(name: string): string {
	return readFileSync(path.join(root, "tests", "fixtures", "workflow-actions", name), "utf8");
}

describe("workflow action policy", () => {
	it("accepts every repository workflow and the Dependabot github-actions configuration", () => {
		expect(() => validateRepository(root)).not.toThrow();
	});

	it("rejects a mutable action reference", () => {
		expect(() => validateWorkflowSource(fixture("mutable-ref.yml"), "mutable-ref.yml", policy)).toThrow(
			/lowercase 40-character commit SHA/,
		);
	});

	it("rejects an immutable but undocumented action pin", () => {
		expect(() => validateWorkflowSource(fixture("undocumented-pin.yaml"), "undocumented-pin.yaml", policy)).toThrow(
			/not documented in \.github\/actions-pins\.json/,
		);
	});
});
