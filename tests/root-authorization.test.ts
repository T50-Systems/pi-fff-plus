import { mkdtempSync, mkdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	findContainingRoot,
	isSameOrInside,
	RootAuthorization,
} from "../src/root-authorization.js";

const fixtures: string[] = [];
afterEach(() => {
	for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

describe("root boundary helpers", () => {
	it("does not confuse sibling-prefix roots", () => {
		expect(isSameOrInside("/tmp/root-secret/file", "/tmp/root", path.posix)).toBe(false);
		expect(findContainingRoot("/tmp/root/nested", ["/tmp/root"], path.posix)).toBe("/tmp/root");
	});

	it("handles Windows case, mixed separators, UNC roots, and drive boundaries", () => {
		expect(isSameOrInside("c:\\WORK\\Root\\src", "C:\\work\\root", path.win32)).toBe(true);
		expect(findContainingRoot("C:/work/root/src", ["C:\\work\\root"], path.win32)).toBe("C:\\work\\root");
		expect(isSameOrInside("\\\\server\\share\\root\\file", "\\\\server\\share\\root", path.win32)).toBe(true);
		expect(isSameOrInside("D:\\work\\root", "C:\\work\\root", path.win32)).toBe(false);
	});
});

describe("RootAuthorization", () => {
	it("accepts valid relative/absolute paths and rejects traversal before indexing", () => {
		const fixture = mkdtempSync(path.join(os.tmpdir(), "fff-root-"));
		fixtures.push(fixture);
		mkdirSync(path.join(fixture, "src"));
		writeFileSync(path.join(fixture, "src", "file.ts"), "ok");
		const auth = new RootAuthorization({ cwd: fixture, extraRoots: [] });
		expect(auth.resolve("src").root).toBe(realpathSync.native(path.join(fixture, "src")));
		expect(auth.resolve(path.join(fixture, "src", "file.ts")).pathForQuery).toBe("file.ts");
		expect(() => auth.resolve("../outside")).toThrow("outside configured FFF roots");
	});

	it("snapshots canonical root path and filesystem object identity", () => {
		const fixture = mkdtempSync(path.join(os.tmpdir(), "fff-identity-"));
		fixtures.push(fixture);
		const auth = new RootAuthorization({ cwd: fixture, extraRoots: [] });
		const identity = statSync(fixture, { bigint: true });
		const canonicalPath = realpathSync.native(fixture).replaceAll("\\", "/");
		expect(auth.snapshotRootIdentity(fixture)).toEqual({
			canonicalPath: process.platform === "win32" ? canonicalPath.toLowerCase() : canonicalPath,
			device: String(identity.dev),
			inode: String(identity.ino),
		});
	});

	it("denies a symlink or junction whose canonical target escapes the root", () => {
		const parent = mkdtempSync(path.join(os.tmpdir(), "fff-links-"));
		fixtures.push(parent);
		const root = path.join(parent, "root");
		const outside = path.join(parent, "outside");
		mkdirSync(root);
		mkdirSync(outside);
		writeFileSync(path.join(outside, "secret.txt"), "not authorized");
		const link = path.join(root, "escape");
		try {
			symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
		} catch (error) {
			console.warn(`symlink capability unavailable: ${String(error)}`);
			return;
		}
		const auth = new RootAuthorization({ cwd: root, extraRoots: [] });
		expect(() => auth.resolve(link)).toThrow("resolves outside configured FFF root");
	});

	it("uses platform-aware Windows authorization in pure fixtures", () => {
		const auth = new RootAuthorization({
			cwd: "C:\\Work\\Root",
			extraRoots: ["\\\\server\\share\\code"],
			pathApi: path.win32,
			exists: () => false,
			realpath: (value) => value,
			stat: () => ({ isDirectory: () => true, dev: 7, ino: 11 }),
		});
		expect(auth.resolve("c:/work/root/src").rootIdentity.toLowerCase()).toBe("c:/work/root");
		expect(auth.resolve("\\\\server\\share\\code\\src").rootIdentity).toBe("//server/share/code");
		expect(auth.snapshotRootIdentity("C:\\Work\\Root")).toEqual({
			canonicalPath: "c:/work/root",
			device: "7",
			inode: "11",
		});
		expect(() => auth.resolve("D:\\Work\\Root")).toThrow("outside configured FFF roots");
	});
});
