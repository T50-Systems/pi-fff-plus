import { normalizeRoot, normalizeSlashes } from "./root-authorization.js";

export interface ManagedFinder {
	readonly isDestroyed: boolean;
	waitForScan(timeoutMs: number): Promise<unknown>;
	destroy(): void;
	scanFiles(): { ok: boolean; error?: string };
	healthCheck(): unknown;
}

export type FinderFactory<T extends ManagedFinder> = (
	root: string,
) => T | Promise<T>;

interface FinderEntry<T> {
	finder: T | null;
	promise: Promise<T> | null;
}

export class FinderLifecycle<T extends ManagedFinder> {
	private readonly entries = new Map<string, FinderEntry<T>>();

	constructor(
		private readonly createFinder: FinderFactory<T>,
		private readonly waitForScanMs = 15_000,
		private readonly onInvalidate: (reason: string) => void = () => {},
	) {}

	async ensure(root: string): Promise<T> {
		const normalizedRoot = normalizeRoot(root);
		let entry = this.entries.get(normalizedRoot);
		if (entry?.finder && !entry.finder.isDestroyed) return entry.finder;
		if (entry?.promise) return entry.promise;

		entry = { finder: null, promise: null };
		this.entries.set(normalizedRoot, entry);
		entry.promise = Promise.resolve(this.createFinder(normalizedRoot))
			.then(async (finder) => {
				entry!.finder = finder;
				await finder.waitForScan(this.waitForScanMs);
				return finder;
			})
			.catch((error) => {
				this.entries.delete(normalizedRoot);
				throw new Error(
					`Failed to create FFF file finder for ${normalizeSlashes(normalizedRoot)}: ${error instanceof Error ? error.message : String(error)}`,
				);
			})
			.finally(() => {
				if (entry) entry.promise = null;
			});
		return entry.promise;
	}

	get(root: string): T | undefined {
		const finder = this.entries.get(normalizeRoot(root))?.finder;
		return finder && !finder.isDestroyed ? finder : undefined;
	}

	initialized(): Array<{ root: string; finder: T }> {
		const output: Array<{ root: string; finder: T }> = [];
		for (const [root, entry] of this.entries) {
			if (entry.finder && !entry.finder.isDestroyed) {
				output.push({ root, finder: entry.finder });
			}
		}
		return output;
	}

	rescan(): number {
		let count = 0;
		for (const { finder } of this.initialized()) {
			if (finder.scanFiles().ok) count++;
		}
		this.onInvalidate("finder rescan");
		return count;
	}

	destroy(): void {
		for (const { finder } of this.initialized()) finder.destroy();
		this.entries.clear();
		this.onInvalidate("finder destruction");
	}
}
