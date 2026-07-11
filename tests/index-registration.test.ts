import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";

function fakePi() {
	const tools: string[] = [];
	const commands: string[] = [];
	const flags: string[] = [];
	const events: string[] = [];
	const pi = {
		getFlag: vi.fn(() => undefined),
		registerFlag: vi.fn((name: string) => flags.push(name)),
		registerTool: vi.fn((tool: { name: string }) => tools.push(tool.name)),
		registerCommand: vi.fn((name: string) => commands.push(name)),
		on: vi.fn((name: string) => events.push(name)),
		appendEntry: vi.fn(),
	};
	return { pi, tools, commands, flags, events };
}

describe("extension registration", () => {
	it("a direct checkout registers stable tools, commands, flags, and lifecycle events", () => {
		const captured = fakePi();
		extension(captured.pi as any);
		expect(captured.tools).toEqual(["ffgrep", "fffind"]);
		expect(captured.commands).toEqual(["fff-mode", "fff-health", "fff-rescan"]);
		expect(captured.flags).toEqual([
			"fff-mode",
			"fff-frecency-db",
			"fff-history-db",
			"fff-enable-root-scan",
		]);
		expect(captured.events).toEqual(["session_start", "session_shutdown"]);
	});
});
