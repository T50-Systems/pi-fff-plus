import { existsSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path, { type PlatformPath } from "node:path";

export interface RootedQuery {
	root: string;
	pathForQuery?: string;
	searchedOutsideActiveCwd: boolean;
	rootGeneration: number;
	rootIdentity: string;
}

export interface RootAuthorizationOptions {
	cwd?: string;
	extraRoots?: string[];
	pathApi?: PlatformPath;
	realpath?: (value: string) => string;
	exists?: (value: string) => boolean;
	stat?: (value: string) => { isDirectory(): boolean };
}

export function normalizeSlashes(value: string): string {
	return value.replaceAll("\\", "/");
}

export function normalizeRoot(value: string, pathApi: PlatformPath = path): string {
	const parsed = pathApi.parse(pathApi.resolve(value));
	const resolved = pathApi.resolve(value);
	return resolved === parsed.root ? resolved : resolved.replace(/[\\/]+$/, "");
}

export function isSameOrInside(
	candidate: string,
	root: string,
	pathApi: PlatformPath = path,
): boolean {
	const relative = pathApi.relative(root, candidate);
	return (
		relative === "" ||
		(!relative.startsWith(`..${pathApi.sep}`) &&
			relative !== ".." &&
			!pathApi.isAbsolute(relative))
	);
}

export function uniqueRoots(
	roots: string[],
	pathApi: PlatformPath = path,
): string[] {
	const seen = new Set<string>();
	const output: string[] = [];
	for (const raw of roots) {
		if (!raw.trim()) continue;
		const root = normalizeRoot(raw.trim(), pathApi);
		const key = pathApi === path.win32 ? root.toLowerCase() : root;
		if (seen.has(key)) continue;
		seen.add(key);
		output.push(root);
	}
	return output;
}

export function splitRootList(value: string | undefined): string[] {
	return value
		? value
				.split(/[;,]/)
				.map((part) => part.trim())
				.filter(Boolean)
		: [];
}

export function defaultExtraRoots(): string[] {
	const home = os.homedir();
	const appData = process.env.APPDATA;
	return uniqueRoots([
		"C:/dev/pi",
		path.join(home, ".pi", "agent"),
		path.join(home, ".agents"),
		...(appData ? [path.join(appData, "npm")] : []),
	]);
}

export function findContainingRoot(
	absolutePath: string,
	roots: string[],
	pathApi: PlatformPath = path,
): string | null {
	const normalized = normalizeRoot(absolutePath, pathApi);
	return (
		roots
			.filter((root) => isSameOrInside(normalized, root, pathApi))
			.sort((a, b) => b.length - a.length)[0] ?? null
	);
}

function queryBase(absoluteInput: string): string {
	const slashInput = normalizeSlashes(absoluteInput);
	const globIndex = slashInput.search(/[*?[{]/);
	if (globIndex === -1) return slashInput;
	const prefix = slashInput.slice(0, globIndex);
	const lastSlash = prefix.lastIndexOf("/");
	return prefix.slice(0, Math.max(0, lastSlash)) || slashInput;
}

export class RootAuthorization {
	private readonly pathApi: PlatformPath;
	private readonly realpath: (value: string) => string;
	private readonly exists: (value: string) => boolean;
	private readonly stat: (value: string) => { isDirectory(): boolean };
	private configuredExtraRoots: string[];
	private _activeCwd: string;
	private _knownRoots: string[];
	private _generation = 1;

	constructor(options: RootAuthorizationOptions = {}) {
		this.pathApi = options.pathApi ?? path;
		this.realpath = options.realpath ?? ((value) => realpathSync.native(value));
		this.exists = options.exists ?? existsSync;
		this.stat = options.stat ?? statSync;
		this.configuredExtraRoots = options.extraRoots ?? [
			...defaultExtraRoots(),
			...splitRootList(process.env.PI_FFF_ROOTS),
		];
		this._activeCwd = normalizeRoot(options.cwd ?? process.cwd(), this.pathApi);
		this._knownRoots = uniqueRoots(
			[this._activeCwd, ...this.configuredExtraRoots],
			this.pathApi,
		);
	}

	get activeCwd(): string {
		return this._activeCwd;
	}

	get knownRoots(): readonly string[] {
		return this._knownRoots;
	}

	get generation(): number {
		return this._generation;
	}

	refresh(cwd: string, extraRoots = this.configuredExtraRoots): void {
		this._activeCwd = normalizeRoot(cwd, this.pathApi);
		this.configuredExtraRoots = [...extraRoots];
		this._knownRoots = uniqueRoots(
			[this._activeCwd, ...this.configuredExtraRoots],
			this.pathApi,
		);
		this._generation++;
	}

	private canonical(value: string): string {
		return normalizeRoot(this.realpath(value), this.pathApi);
	}

	private verifyCanonicalContainment(candidate: string, lexicalRoot: string): string {
		const canonicalRoot = this.exists(lexicalRoot)
			? this.canonical(lexicalRoot)
			: normalizeRoot(lexicalRoot, this.pathApi);
		if (!this.exists(candidate)) return candidate;
		const canonicalCandidate = this.canonical(candidate);
		if (!isSameOrInside(canonicalCandidate, canonicalRoot, this.pathApi)) {
			throw new Error(
				`Path resolves outside configured FFF root through a symlink or junction: ${normalizeSlashes(candidate)}. Restart with the canonical target explicitly listed in PI_FFF_ROOTS only if it is trusted.`,
			);
		}
		return canonicalCandidate;
	}

	resolve(rawPath?: string): RootedQuery {
		if (!rawPath?.trim()) {
			const root = this.verifyCanonicalContainment(this._activeCwd, this._activeCwd);
			return {
				root,
				searchedOutsideActiveCwd: false,
				rootGeneration: this._generation,
				rootIdentity: normalizeSlashes(root),
			};
		}

		const trimmed = rawPath.trim();
		const absoluteInput = this.pathApi.isAbsolute(trimmed)
			? normalizeRoot(queryBase(trimmed), this.pathApi)
			: normalizeRoot(this.pathApi.resolve(this._activeCwd, queryBase(trimmed)), this.pathApi);
		const lexicalRoot = findContainingRoot(
			absoluteInput,
			this._knownRoots,
			this.pathApi,
		);
		if (!lexicalRoot) {
			throw new Error(
				`Path is outside configured FFF roots: ${normalizeSlashes(trimmed)}. Configured roots: ${this._knownRoots.map(normalizeSlashes).join(", ")}. Set PI_FFF_ROOTS="root1;root2" to add the smallest trusted root.`,
			);
		}

		const canonicalCandidate = this.verifyCanonicalContainment(
			absoluteInput,
			lexicalRoot,
		);
		let finderRoot = canonicalCandidate;
		let pathForQuery: string | undefined;
		if (this.exists(canonicalCandidate) && !this.stat(canonicalCandidate).isDirectory()) {
			finderRoot = this.pathApi.dirname(canonicalCandidate);
			pathForQuery = this.pathApi.basename(canonicalCandidate);
		} else if (this.pathApi.isAbsolute(trimmed)) {
			const slashInput = normalizeSlashes(trimmed);
			const baseSlash = normalizeSlashes(queryBase(trimmed));
			const suffix = slashInput.slice(baseSlash.length).replace(/^\/+/, "");
			pathForQuery = suffix || undefined;
		} else {
			pathForQuery = normalizeSlashes(
				this.pathApi.relative(canonicalCandidate, this.pathApi.resolve(this._activeCwd, trimmed)),
			);
			if (!pathForQuery || pathForQuery === ".") pathForQuery = undefined;
		}

		return {
			root: finderRoot,
			pathForQuery,
			searchedOutsideActiveCwd:
				normalizeRoot(finderRoot, this.pathApi) !==
				normalizeRoot(this._activeCwd, this.pathApi),
			rootGeneration: this._generation,
			rootIdentity: normalizeSlashes(this.canonical(lexicalRoot)),
		};
	}
}
