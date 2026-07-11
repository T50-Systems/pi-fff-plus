import { bench, describe } from "vitest";
import { buildQuery } from "../src/query.js";

const cwd = "C:/dev/pi/T50-Systems/pi-fff-plus";

describe("query normalization", () => {
	bench("relative source constraint", () => {
		buildQuery("src/**", "registerTool", ["node_modules", "dist"], cwd);
	});

	bench("multi-exclusion query", () => {
		buildQuery(
			"src/**/*.ts",
			"normalizePathConstraint",
			["node_modules", "dist", "coverage", ".git"],
			cwd,
		);
	});
});
