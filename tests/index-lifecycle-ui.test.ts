import { beforeEach, describe, expect, it, vi } from "vitest";

const fffMock = vi.hoisted(() => ({
	create: vi.fn(),
}));

vi.mock("@ff-labs/fff-node", () => ({
	FileFinder: { create: fffMock.create },
}));

import extension from "../src/index.js";

interface HarnessOptions {
	entries?: unknown[];
	flags?: Record<string, unknown>;
}

function createFinder() {
	return {
		isDestroyed: false,
		waitForScan: vi.fn(async () => ({ ok: true })),
		mixedSearch: vi.fn(() => ({ ok: true, value: { items: [] } })),
		healthCheck: vi.fn(() => ({
			ok: true,
			value: { filePicker: { indexedFiles: 7 } },
		})),
		scanFiles: vi.fn(() => ({ ok: true })),
		destroy: vi.fn(),
	};
}

function createHarness(options: HarnessOptions = {}) {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const events = new Map<string, (...args: any[]) => any>();
	const appended: Array<{ customType: string; data: unknown }> = [];
	const notify = vi.fn();
	const addAutocompleteProvider = vi.fn();
	const pi = {
		getFlag: vi.fn((name: string) => options.flags?.[name]),
		registerFlag: vi.fn(),
		registerTool: vi.fn((tool: { name: string }) => tools.set(tool.name, tool)),
		registerCommand: vi.fn((name: string, command: unknown) => commands.set(name, command)),
		on: vi.fn((name: string, handler: (...args: any[]) => any) => events.set(name, handler)),
		appendEntry: vi.fn((customType: string, data: unknown) => appended.push({ customType, data })),
	};
	extension(pi as any);
	const context = {
		cwd: process.cwd(),
		ui: { notify, addAutocompleteProvider },
		sessionManager: { getEntries: vi.fn(() => options.entries) },
	};
	return { pi, tools, commands, events, appended, notify, addAutocompleteProvider, context };
}

function currentAutocompleteProvider() {
	return {
		getSuggestions: vi.fn(async () => ({
			items: [{ value: "@delegated", label: "delegated" }],
			prefix: "@del",
		})),
		applyCompletion: vi.fn(() => ({ lines: ["delegated"], cursorLine: 0, cursorCol: 9 })),
		shouldTriggerFileCompletion: vi.fn(() => false),
	};
}

function testTheme() {
	return {
		fg: (color: string, value: string) => `[${color}]${value}`,
		bold: (value: string) => `<b>${value}</b>`,
	};
}

let finder: ReturnType<typeof createFinder>;

beforeEach(() => {
	finder = createFinder();
	fffMock.create.mockReset();
	fffMock.create.mockReturnValue({ ok: true, value: finder });
});

describe("session lifecycle", () => {
	it("restores the newest valid mode while skipping malformed state", async () => {
		const harness = createHarness({
			entries: [
				null,
				{ type: "custom", customType: "fff-mode", data: { mode: "tools-only" } },
				{ type: "custom", customType: "fff-mode", data: null },
			],
		});

		await harness.events.get("session_start")?.({}, harness.context);
		await harness.commands.get("fff-mode").handler("", harness.context);

		expect(harness.notify).toHaveBeenCalledWith("Current mode: 'tools-only'", "info");
		expect(harness.addAutocompleteProvider).toHaveBeenCalledOnce();
		expect(finder.waitForScan).toHaveBeenCalledWith(15_000);
		expect(harness.notify).not.toHaveBeenCalledWith(expect.stringContaining("init failed"), "error");
	});

	it("ignores invalid persisted modes", async () => {
		const harness = createHarness({
			entries: [
				undefined,
				{ type: "custom", customType: "fff-mode", data: { mode: 42 } },
				{ type: "custom", customType: "fff-mode", data: { mode: "not-a-mode" } },
			],
		});

		await harness.events.get("session_start")?.({}, harness.context);
		await harness.commands.get("fff-mode").handler("", harness.context);

		expect(harness.notify).toHaveBeenCalledWith("Current mode: 'tools-and-ui'", "info");
	});

	it("reports deterministic initialization failures", async () => {
		fffMock.create.mockReturnValueOnce({ ok: false, error: "fixture unavailable" });
		const harness = createHarness();

		await harness.events.get("session_start")?.({}, harness.context);

		expect(harness.notify).toHaveBeenCalledWith(
			"FFF+ init failed: Failed to create FFF file finder for " + process.cwd().replaceAll("\\", "/") + ": fixture unavailable",
			"error",
		);
	});

	it("destroys initialized finders on shutdown", async () => {
		const harness = createHarness();
		await harness.events.get("session_start")?.({}, harness.context);

		await harness.events.get("session_shutdown")?.();

		expect(finder.destroy).toHaveBeenCalledOnce();
	});
});

describe("autocomplete composition", () => {
	it("returns deterministic FFF mentions before delegating", async () => {
		finder.mixedSearch.mockReturnValue({
			ok: true,
			value: {
				items: [{
					type: "file",
					item: { relativePath: "src/space file.ts", fileName: "space file.ts" },
				}],
			},
		} as any);
		const harness = createHarness();
		await harness.events.get("session_start")?.({}, harness.context);
		const current = currentAutocompleteProvider();
		const provider = harness.addAutocompleteProvider.mock.calls[0][0](current);
		const signal = new AbortController().signal;

		const result = await provider.getSuggestions(["open @spa"], 0, 9, { signal });

		expect(finder.mixedSearch).toHaveBeenCalledWith("spa", { pageSize: 20 });
		expect(result).toEqual({
			prefix: "@spa",
			items: [{ value: "@\"src/space file.ts\"", label: "space file.ts", description: "src/space file.ts" }],
		});
		expect(current.getSuggestions).not.toHaveBeenCalled();
		expect(provider.applyCompletion(["@spa"], 0, 4, result.items[0], "@spa"))
			.toEqual({ lines: ["delegated"], cursorLine: 0, cursorCol: 9 });
		expect(provider.shouldTriggerFileCompletion(["@spa"], 0, 4)).toBe(false);
	});

	it("delegates in tools-only mode and when local suggestions fail", async () => {
		const restored = createHarness({
			entries: [{ type: "custom", customType: "fff-mode", data: { mode: "tools-only" } }],
		});
		await restored.events.get("session_start")?.({}, restored.context);
		const current = currentAutocompleteProvider();
		const provider = restored.addAutocompleteProvider.mock.calls[0][0](current);
		const signal = new AbortController().signal;

		await expect(provider.getSuggestions(["@del"], 0, 4, { signal }))
			.resolves.toEqual({ items: [{ value: "@delegated", label: "delegated" }], prefix: "@del" });
		expect(finder.mixedSearch).not.toHaveBeenCalled();

		const fallback = createHarness();
		await fallback.events.get("session_start")?.({}, fallback.context);
		finder.mixedSearch.mockImplementationOnce(() => { throw new Error("fixture search failure"); });
		const fallbackCurrent = currentAutocompleteProvider();
		const fallbackProvider = fallback.addAutocompleteProvider.mock.calls[0][0](fallbackCurrent);
		await fallbackProvider.getSuggestions(["@del"], 0, 4, { signal });
		expect(fallbackCurrent.getSuggestions).toHaveBeenCalledOnce();
	});
});

describe("commands and mode persistence", () => {
	it("persists mode changes and emits stable notifications", async () => {
		const harness = createHarness();
		await harness.events.get("session_start")?.({}, harness.context);
		const mode = harness.commands.get("fff-mode");

		await mode.handler("bad-mode", harness.context);
		await mode.handler(" tools-only ", harness.context);
		await mode.handler("override", harness.context);
		await harness.commands.get("fff-rescan").handler("", harness.context);
		await harness.commands.get("fff-health").handler("", harness.context);

		expect(harness.notify).toHaveBeenNthCalledWith(1, "Usage: /fff-mode [tools-and-ui | tools-only | override]", "warning");
		expect(harness.appended).toEqual([
			{ customType: "fff-mode", data: { mode: "tools-only" } },
			{ customType: "fff-mode", data: { mode: "override" } },
		]);
		expect(harness.notify).toHaveBeenCalledWith("Mode changed: 'tools-and-ui' → 'tools-only'", "info");
		expect(harness.notify).toHaveBeenCalledWith("Mode changed: 'tools-only' → 'override' (tool name change requires /reload)", "info");
		expect(harness.notify).toHaveBeenCalledWith("FFF+ rescan triggered for 1 initialized root", "info");
		expect(harness.notify).toHaveBeenCalledWith(expect.stringContaining("FFF+ mode: override"), "info");
		expect(harness.notify).toHaveBeenCalledWith(expect.stringContaining("7 files"), "info");
	});
});

describe("tool rendering", () => {
	it("renders calls, empty results, truncation, expansion, and component reuse without a terminal", () => {
		const harness = createHarness();
		const grep = harness.tools.get("ffgrep");
		const find = harness.tools.get("fffind");
		const component = { setText: vi.fn() };
		const theme = testTheme();

		expect(grep.renderCall({ pattern: "needle", path: "src" }, theme, { lastComponent: component })).toBe(component);
		expect(component.setText).toHaveBeenLastCalledWith(
			"[toolTitle]<b>ffgrep</b> [accent]/needle/[toolOutput] in src",
		);

		expect(grep.renderResult({ content: [] }, {}, theme, { lastComponent: component })).toBe(component);
		expect(component.setText).toHaveBeenLastCalledWith("[muted]No output");

		const lines = Array.from({ length: 17 }, (_, index) => `line-${index + 1}`);
		grep.renderResult(
			{ content: [{ type: "text", text: `  ${lines.join("\n")}  ` }] },
			{ expanded: false },
			theme,
			{ lastComponent: component },
		);
		expect(component.setText).toHaveBeenLastCalledWith(
			`\n${lines.slice(0, 15).map((line) => `[toolOutput]${line}`).join("\n")}[muted]\n... (2 more lines)`,
		);

		find.renderResult(
			{ content: [{ type: "text", text: "one\ntwo" }] },
			{ expanded: true },
			theme,
			{ lastComponent: component },
		);
		expect(component.setText).toHaveBeenLastCalledWith("\n[toolOutput]one\n[toolOutput]two");
	});
});
