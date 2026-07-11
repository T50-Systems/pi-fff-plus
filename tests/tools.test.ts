import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CursorStore } from "../src/cursors.js";
import { RootAuthorization } from "../src/root-authorization.js";
import {
	executeFind,
	executeGrep,
	formatGrepOutput,
	grepSchema,
	MAX_CONTEXT_LINES,
	MAX_GREP_LIMIT,
	MAX_OUTPUT_BYTES,
	MAX_OUTPUT_LINES,
	type SearchToolDependencies,
} from "../src/tools.js";

function grepMatch(relativePath: string, lineNumber: number, lineContent = "match") {
	return {
		relativePath,
		fileName: path.basename(relativePath),
		gitStatus: "clean",
		totalFrecencyScore: 0,
		accessFrecencyScore: 0,
		modificationFrecencyScore: 0,
		lineNumber,
		col: 0,
		byteOffset: 0,
		lineContent,
		matchRanges: [[0, 1]],
	};
}

function grepValue(items: any[], nextCursor: any = null) {
	return {
		items,
		totalMatched: items.length,
		totalFilesSearched: new Set(items.map((item) => item.relativePath)).size,
		totalFiles: new Set(items.map((item) => item.relativePath)).size,
		filteredFileCount: new Set(items.map((item) => item.relativePath)).size,
		nextCursor,
	};
}

function findValue(names: string[], totalMatched = names.length, score = 100) {
	return {
		items: names.map((relativePath) => ({
			relativePath,
			fileName: path.basename(relativePath),
			gitStatus: "clean",
			totalFrecencyScore: 0,
			accessFrecencyScore: 0,
		})),
		scores: names.map(() => ({ total: score })),
		totalMatched,
		totalFiles: totalMatched,
	};
}

function harness(finder: any, cwd = process.cwd()): SearchToolDependencies & { ensure: ReturnType<typeof vi.fn> } {
	const ensure = vi.fn(async () => finder);
	return {
		roots: new RootAuthorization({ cwd, extraRoots: [] }),
		finders: { ensure } as any,
		cursors: new CursorStore(),
		ensure,
	};
}

function text(result: { content: Array<{ text: string }> }): string {
	return result.content[0].text;
}

describe("caller budgets", () => {
	it("publishes schema maxima and rejects invalid execution budgets", async () => {
		const properties = (grepSchema as any).properties;
		expect(properties.limit.maximum).toBe(MAX_GREP_LIMIT);
		expect(properties.context.maximum).toBe(MAX_CONTEXT_LINES);
		const deps = harness({ grep: vi.fn() });
		for (const limit of [0, -1, Number.NaN, MAX_GREP_LIMIT + 1]) {
			await expect(executeGrep({ pattern: "x", limit }, undefined, deps)).rejects.toThrow("limit must be an integer");
		}
		await expect(executeGrep({ pattern: "x", context: MAX_CONTEXT_LINES + 1 }, undefined, deps)).rejects.toThrow("context must be an integer");
		expect(deps.ensure).not.toHaveBeenCalled();
	});

	it("keeps worst-case formatted output below byte and line budgets", () => {
		const context = Array.from({ length: MAX_CONTEXT_LINES }, () => "x".repeat(2_000));
		const items = Array.from({ length: MAX_GREP_LIMIT }, (_, index) => ({
			...grepMatch(`src/file-${index}.ts`, index + 10, "x".repeat(2_000)),
			contextBefore: context,
			contextAfter: context,
		}));
		const formatted = formatGrepOutput(grepValue(items) as any, process.cwd(), process.cwd(), MAX_GREP_LIMIT);
		expect(Buffer.byteLength(formatted.output)).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
		expect(formatted.output.split("\n").length).toBeLessThanOrEqual(MAX_OUTPUT_LINES);
	});
});

describe("ffgrep execution", () => {
	it("enforces the global display cap across files and provides continuation", async () => {
		const finder = {
			grep: vi.fn(() => ({ ok: true, value: grepValue([
				grepMatch("a.ts", 1), grepMatch("a.ts", 2), grepMatch("b.ts", 1),
			], { fileIndex: 2, byteOffset: 0 }) })),
		};
		const deps = harness(finder);
		const result = await executeGrep({ pattern: "match", limit: 2 }, undefined, deps);
		expect((text(result).match(/ \d+: /g) ?? []).length).toBe(2);
		expect(text(result)).toContain("Continue with cursor=");
	});

	it("supports valid continuation and rejects mismatch or stale generations before finder use", async () => {
		const finder = {
			grep: vi.fn()
				.mockReturnValueOnce({ ok: true, value: grepValue([grepMatch("a.ts", 1)], { fileIndex: 1, byteOffset: 0 }) })
				.mockReturnValue({ ok: true, value: grepValue([]) }),
		};
		const deps = harness(finder);
		const first = await executeGrep({ pattern: "match", limit: 1 }, undefined, deps);
		const cursor = text(first).match(/cursor="([^"]+)"/)![1];
		const final = await executeGrep({ pattern: "match", limit: 1, cursor }, undefined, deps);
		expect(text(final)).toBe("No matches found");
		expect(text(final)).not.toContain("Continue with cursor=");
		await expect(executeGrep({ pattern: "changed", limit: 1, cursor }, undefined, deps)).rejects.toThrow("does not match");
		deps.roots.refresh(deps.roots.activeCwd);
		await expect(executeGrep({ pattern: "match", limit: 1, cursor }, undefined, deps)).rejects.toThrow("root generation");
	});

	it("reports invalid-regex literal and fuzzy recovery, then continues in immutable fuzzy mode", async () => {
		const finder = {
			grep: vi.fn()
				.mockReturnValueOnce({ ok: true, value: grepValue([]) })
				.mockReturnValueOnce({ ok: true, value: grepValue([grepMatch("wanted.ts", 1)], { fileIndex: 1, byteOffset: 0 }) })
				.mockReturnValueOnce({ ok: true, value: grepValue([]) }),
		};
		const deps = harness(finder);
		const result = await executeGrep({ pattern: "[" }, undefined, deps);
		expect(text(result)).toContain("Invalid regex");
		expect(text(result)).toContain("Maybe you meant this");
		expect(text(result)).not.toContain("unrelated");
		expect(finder.grep.mock.calls[0][1].mode).toBe("plain");
		expect(finder.grep.mock.calls[1][1].mode).toBe("fuzzy");
		const cursor = text(result).match(/cursor="([^"]+)"/)![1];
		await executeGrep({ pattern: "[", cursor }, undefined, deps);
		expect(finder.grep.mock.calls[2][0]).toBe("[");
		expect(finder.grep.mock.calls[2][1].mode).toBe("fuzzy");
		expect(finder.grep.mock.calls[2][1].cursor).toEqual({ fileIndex: 1, byteOffset: 0 });
	});

	it("rejects external roots and aborts before finder creation, and makes allowed external paths absolute", async () => {
		const deps = harness({ grep: vi.fn() });
		await expect(executeGrep({ pattern: "x", path: path.resolve(process.cwd(), "..", "outside") }, undefined, deps)).rejects.toThrow("outside configured FFF roots");
		await expect(executeGrep({ pattern: "x" }, AbortSignal.abort(), deps)).rejects.toThrow("Operation aborted");
		expect(deps.ensure).not.toHaveBeenCalled();

		const parent = path.dirname(process.cwd());
		const externalFinder = { grep: vi.fn(() => ({ ok: true, value: grepValue([grepMatch("file.ts", 1)]) })) };
		const external = harness(externalFinder, process.cwd());
		external.roots.refresh(process.cwd(), [parent]);
		const result = await executeGrep({ pattern: "x", path: parent }, undefined, external);
		expect(text(result)).toContain(path.resolve(parent, "file.ts").replaceAll("\\", "/"));
	});

	it("returns actionable finder failures", async () => {
		const deps = harness({ grep: vi.fn(() => ({ ok: false, error: "index unavailable" })) });
		await expect(executeGrep({ pattern: "x" }, undefined, deps)).rejects.toThrow("run /fff-rescan");
	});
});

describe("fffind execution", () => {
	it("covers first, continuation, and final pages", async () => {
		const finder = {
			fileSearch: vi.fn()
				.mockReturnValueOnce({ ok: true, value: findValue(["a.ts", "b.ts"], 3) })
				.mockReturnValueOnce({ ok: true, value: findValue(["c.ts"], 3) }),
		};
		const deps = harness(finder);
		const first = await executeFind({ pattern: "ts", limit: 2 }, undefined, deps);
		expect(text(first)).toContain("more match");
		const cursor = text(first).match(/cursor="([^"]+)"/)![1];
		const final = await executeFind({ pattern: "ts", limit: 2, cursor }, undefined, deps);
		expect(text(final)).toContain("c.ts");
		expect(text(final)).not.toContain("more match");
	});

	it("caps weak fuzzy matches with an actionable notice and reports failures", async () => {
		const weak = harness({ fileSearch: vi.fn(() => ({ ok: true, value: findValue(["a", "b", "c", "d", "e", "f"], 6, 0) })) });
		const result = await executeFind({ pattern: "unlikely", limit: 10 }, undefined, weak);
		expect(text(result)).toContain("weak scattered fuzzy matches");
		expect(text(result).split("\n").filter((line) => /^[a-f]$/.test(line))).toHaveLength(5);
		const failed = harness({ fileSearch: vi.fn(() => ({ ok: false, error: "broken" })) });
		await expect(executeFind({ pattern: "x" }, undefined, failed)).rejects.toThrow("run /fff-rescan");
	});
});
