import { describe, expect, it } from "vitest";
import { CursorStore, type CursorBinding } from "../src/cursors.js";

const binding: CursorBinding = {
	kind: "grep",
	rootIdentity: "/root",
	rootGeneration: 1,
	pattern: "needle",
	path: "src",
	exclude: ["dist"],
	caseSensitive: false,
	context: 1,
	limit: 20,
	mode: "plain",
};

describe("CursorStore", () => {
	it("resumes only with immutable query bindings", () => {
		const store = new CursorStore();
		const id = store.store({ binding, state: { page: 2 } });
		expect(store.resume<{ page: number }>(id, binding)).toEqual({ page: 2 });
		expect(() => store.resume(id, { ...binding, pattern: "changed" })).toThrow("does not match");
		expect(() => store.resume(id, { ...binding, rootGeneration: 2 })).toThrow("does not match");
	});

	it("reports unknown and evicted cursors with a restart action", () => {
		const store = new CursorStore(1);
		const evicted = store.store({ binding, state: 1 });
		store.store({ binding, state: 2 });
		expect(() => store.read(evicted)).toThrow("Restart the query without cursor");
		expect(() => store.read("missing")).toThrow("Unknown or evicted cursor");
	});
});
