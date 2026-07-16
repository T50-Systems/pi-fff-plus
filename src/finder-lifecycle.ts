import { normalizeRoot, normalizeSlashes, type RootIdentitySnapshot } from "./root-authorization.js";

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

export type RootIdentitySnapshotter = (root: string) => RootIdentitySnapshot;

interface FinderEntry<T> {
	finder: T | null;
	promise: Promise<T> | null;
}

function snapshotsMatch(
	before: RootIdentitySnapshot,
	after: RootIdentitySnapshot,
): boolean {
	return (
		before.canonicalPath === after.canonicalPath &&
		before.device === after.device &&
		before.inode === after.inode
	);
}

export class FinderLifecycle<T extends ManagedFinder> {
	private readonly entries = new Map<string, FinderEntry<T>>();

	constructor(
		private readonly createFinder: FinderFactory<T>,
		private readonly waitForScanMs: number,
		private readonly onInvalidate: (reason: string) => void,
		private readonly snapshotRootIdentity: RootIdentitySnapshotter,
	) {}

	async ensure(root: string): Promise<T> {
		const normalizedRoot = normalizeRoot(root);
		let entry = this.entries.get(normalizedRoot);
		if (entry?.finder && !entry.finder.isDestroyed) return entry.finder;
		if (entry?.promise) return entry.promise;

		entry = { finder: null, promise: null };
		this.entries.set(normalizedRoot, entry);
		entry.promise = (async () => {
			let finder: T | undefined;
			let finderDestroyed = false;
			const destroyCreatedFinder = () => {
				if (!finder || finderDestroyed) return;
				finderDestroyed = true;
				finder.destroy();
			};
			try {
				const before = this.snapshotRootIdentity(normalizedRoot);
				const created = this.createFinder(normalizedRoot);
				finder = created instanceof Promise ? await created : created;
				let after: RootIdentitySnapshot;
				try {
					after = this.snapshotRootIdentity(normalizedRoot);
				} catch (error) {
					destroyCreatedFinder();
					this.onInvalidate("root identity verification failure");
					throw error;
				}
				if (!snapshotsMatch(before, after)) {
					destroyCreatedFinder();
					this.onInvalidate("root identity mismatch");
					throw new Error(
						`Root identity changed while creating the FFF file finder for ${normalizeSlashes(normalizedRoot)}`,
					);
				}
				entry!.finder = finder;
				await finder.waitForScan(this.waitForScanMs);
				return finder;
			} catch (error) {
				destroyCreatedFinder();
				this.entries.delete(normalizedRoot);
				throw new Error(
					`Failed to create FFF file finder for ${normalizeSlashes(normalizedRoot)}: ${error instanceof Error ? error.message : String(error)}`,
				);
			} finally {
				if (entry) entry.promise = null;
			}
		})();
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
