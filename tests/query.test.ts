import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildQuery,
	normalizeExcludes,
	normalizePathConstraint,
} from "../src/query.js";

const cwd = path.resolve("C:/workspace/project");

describe("normalizePathConstraint", () => {
	it("normalizes current directory and relative directory constraints", () => {
		expect(normalizePathConstraint(".", cwd)).toBeNull();
		expect(normalizePathConstraint("./src", cwd)).toBe("src/");
		expect(normalizePathConstraint("src/**", cwd)).toBe("src/");
	});

	it("preserves file and glob constraints", () => {
		expect(normalizePathConstraint("src/index.ts", cwd)).toBe("src/index.ts");
		expect(normalizePathConstraint("src/**/*.ts", cwd)).toBe("src/**/*.ts");
	});

	it("rejects absolute paths outside the selected root", () => {
		const outside = path.resolve(cwd, "..", "other");
		expect(() => normalizePathConstraint(outside, cwd)).toThrow(
			"Path constraint must be relative to the workspace",
		);
	});
});

describe("normalizeExcludes", () => {
	it("splits, normalizes, and avoids double negation", () => {
		expect(normalizeExcludes(["node_modules, dist", "!coverage/"], cwd)).toEqual([
			"!node_modules/",
			"!dist/",
			"!coverage/",
		]);
	});
});

describe("buildQuery", () => {
	it("combines path, exclusions, and pattern deterministically", () => {
		expect(buildQuery("src", "registerTool", ["dist", "coverage"], cwd)).toBe(
			"src/ !dist/ !coverage/ registerTool",
		);
	});
});
