import { describe, expect, it, vi } from "vitest";
import { FinderLifecycle, type ManagedFinder } from "../src/finder-lifecycle.js";

function fakeFinder(): ManagedFinder {
	return {
		isDestroyed: false,
		waitForScan: vi.fn(async () => ({ ok: true })),
		destroy: vi.fn(),
		scanFiles: vi.fn(() => ({ ok: true })),
		healthCheck: vi.fn(() => ({ ok: true })),
	};
}

describe("FinderLifecycle", () => {
	it("coalesces creation, waits for scan, caches, rescans, and destroys", async () => {
		const finder = fakeFinder();
		const create = vi.fn(async () => finder);
		const invalidate = vi.fn();
		const lifecycle = new FinderLifecycle(create, 123, invalidate);
		const [first, second] = await Promise.all([lifecycle.ensure("."), lifecycle.ensure(".")]);
		expect(first).toBe(second);
		expect(create).toHaveBeenCalledTimes(1);
		expect(finder.waitForScan).toHaveBeenCalledWith(123);
		expect(lifecycle.rescan()).toBe(1);
		expect(invalidate).toHaveBeenCalledWith("finder rescan");
		lifecycle.destroy();
		expect(finder.destroy).toHaveBeenCalledOnce();
		expect(invalidate).toHaveBeenCalledWith("finder destruction");
	});

	it("does not retain failed finder creation", async () => {
		const create = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(fakeFinder());
		const lifecycle = new FinderLifecycle(create);
		await expect(lifecycle.ensure(".")).rejects.toThrow("Failed to create FFF file finder");
		await expect(lifecycle.ensure(".")).resolves.toBeDefined();
		expect(create).toHaveBeenCalledTimes(2);
	});
});
