import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileFinder } from "@ff-labs/fff-node";
import { describe, expect, it } from "vitest";

describe("@ff-labs/fff-node compatibility", () => {
	it("creates, scans, greps, searches files, reports health, rescans, and destroys", async () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "fff-compat-"));
		writeFileSync(path.join(root, "alpha.ts"), "export const compatibilityNeedle = true;\n");
		writeFileSync(path.join(root, "beta.md"), "fixture\n");
		const created = FileFinder.create({ basePath: root, aiMode: true });
		if (!created.ok) throw new Error(created.error);
		const finder = created.value;
		try {
			const scanned = await finder.waitForScan(15_000);
			expect(scanned.ok).toBe(true);
			const grep = finder.grep("compatibilityNeedle", { mode: "plain", pageSize: 10 });
			expect(grep.ok).toBe(true);
			if (grep.ok) expect(grep.value.items.some((item) => item.relativePath.endsWith("alpha.ts"))).toBe(true);
			const files = finder.fileSearch("alpha", { pageIndex: 0, pageSize: 10 });
			expect(files.ok).toBe(true);
			if (files.ok) expect(files.value.items.some((item) => item.relativePath.endsWith("alpha.ts"))).toBe(true);
			expect(finder.healthCheck().ok).toBe(true);
			expect(finder.scanFiles().ok).toBe(true);
		} finally {
			finder.destroy();
			rmSync(root, { recursive: true, force: true });
		}
		expect(finder.isDestroyed).toBe(true);
	}, 30_000);
});
