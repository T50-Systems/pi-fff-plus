import { mkdtempSync, mkdirSync, renameSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FinderLifecycle, type ManagedFinder } from "../src/finder-lifecycle.js";
import { RootAuthorization, type RootIdentitySnapshot } from "../src/root-authorization.js";

const fixtures: string[] = [];
afterEach(() => {
	for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

function fakeFinder(): ManagedFinder {
	return {
		isDestroyed: false,
		waitForScan: vi.fn(async () => ({ ok: true })),
		destroy: vi.fn(),
		scanFiles: vi.fn(() => ({ ok: true })),
		healthCheck: vi.fn(() => ({ ok: true })),
	};
}

const stableIdentity: RootIdentitySnapshot = {
	canonicalPath: "/root",
	device: "1",
	inode: "1",
};

describe("FinderLifecycle", () => {
	it("coalesces guarded creation, waits for scan, caches, rescans, and destroys", async () => {
		const finder = fakeFinder();
		const create = vi.fn(async () => finder);
		const invalidate = vi.fn();
		const snapshot = vi.fn(() => stableIdentity);
		const lifecycle = new FinderLifecycle(create, 123, invalidate, snapshot);
		const [first, second] = await Promise.all([lifecycle.ensure("."), lifecycle.ensure(".")]);
		expect(first).toBe(second);
		expect(create).toHaveBeenCalledTimes(1);
		expect(snapshot).toHaveBeenCalledTimes(2);
		expect(finder.waitForScan).toHaveBeenCalledWith(123);
		expect(lifecycle.rescan()).toBe(1);
		expect(invalidate).toHaveBeenCalledWith("finder rescan");
		lifecycle.destroy();
		expect(finder.destroy).toHaveBeenCalledOnce();
		expect(invalidate).toHaveBeenCalledWith("finder destruction");
	});

	it("destroys and invalidates a finder when injected pre/post identities mismatch", async () => {
		const firstFinder = fakeFinder();
		const replacementFinder = fakeFinder();
		const create = vi.fn().mockResolvedValueOnce(firstFinder).mockResolvedValueOnce(replacementFinder);
		const invalidate = vi.fn();
		const replacedIdentity = { ...stableIdentity, inode: "2" };
		const snapshot = vi
			.fn()
			.mockReturnValueOnce(stableIdentity)
			.mockReturnValueOnce(replacedIdentity)
			.mockReturnValueOnce(replacedIdentity)
			.mockReturnValueOnce(replacedIdentity);
		const lifecycle = new FinderLifecycle(create, 123, invalidate, snapshot);

		await expect(lifecycle.ensure(".")).rejects.toThrow("Root identity changed while creating");
		expect(firstFinder.destroy).toHaveBeenCalledOnce();
		expect(firstFinder.waitForScan).not.toHaveBeenCalled();
		expect(lifecycle.get(".")).toBeUndefined();
		expect(invalidate).toHaveBeenCalledWith("root identity mismatch");
		await expect(lifecycle.ensure(".")).resolves.toBe(replacementFinder);
		expect(create).toHaveBeenCalledTimes(2);
	});

	it("destroys and invalidates when the post-create identity cannot be observed", async () => {
		const finder = fakeFinder();
		const invalidate = vi.fn();
		const snapshot = vi
			.fn()
			.mockReturnValueOnce(stableIdentity)
			.mockImplementationOnce(() => {
				throw new Error("root disappeared");
			});
		const lifecycle = new FinderLifecycle(() => finder, 123, invalidate, snapshot);

		await expect(lifecycle.ensure(".")).rejects.toThrow("root disappeared");
		expect(finder.destroy).toHaveBeenCalledOnce();
		expect(finder.waitForScan).not.toHaveBeenCalled();
		expect(invalidate).toHaveBeenCalledWith("root identity verification failure");
	});

	it("does not retain failed finder creation", async () => {
		const create = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(fakeFinder());
		const snapshot = vi.fn(() => stableIdentity);
		const lifecycle = new FinderLifecycle(create, 15_000, () => {}, snapshot);
		await expect(lifecycle.ensure(".")).rejects.toThrow("Failed to create FFF file finder");
		await expect(lifecycle.ensure(".")).resolves.toBeDefined();
		expect(create).toHaveBeenCalledTimes(2);
	});

	it("detects a real symlink or Windows junction replacement during creation when supported", async () => {
		const parent = mkdtempSync(path.join(os.tmpdir(), "fff-root-race-"));
		fixtures.push(parent);
		const root = path.join(parent, "root");
		const original = path.join(parent, "original");
		const outside = path.join(parent, "outside");
		const probe = path.join(parent, "link-probe");
		mkdirSync(root);
		mkdirSync(outside);
		try {
			symlinkSync(outside, probe, process.platform === "win32" ? "junction" : "dir");
			rmSync(probe, { recursive: true, force: true });
		} catch (error) {
			console.warn(`symlink/junction capability unavailable: ${String(error)}`);
			return;
		}
		const finder = fakeFinder();
		const authorization = new RootAuthorization({ cwd: root, extraRoots: [] });
		const lifecycle = new FinderLifecycle(
			() => {
				renameSync(root, original);
				symlinkSync(outside, root, process.platform === "win32" ? "junction" : "dir");
				return finder;
			},
			123,
			vi.fn(),
			(value) => authorization.snapshotRootIdentity(value),
		);

		await expect(lifecycle.ensure(root)).rejects.toThrow("Root identity changed while creating");
		expect(finder.destroy).toHaveBeenCalledOnce();
		expect(finder.waitForScan).not.toHaveBeenCalled();
	});
});
