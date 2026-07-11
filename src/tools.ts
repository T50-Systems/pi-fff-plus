import path from "node:path";
import type {
	FileFinderApi,
	GrepCursor,
	GrepMode,
	GrepResult,
	SearchResult,
} from "@ff-labs/fff-node";
import { Type } from "@sinclair/typebox";
import { buildQuery } from "./query.js";
import { type CursorBinding, CursorStore } from "./cursors.js";
import type { FinderLifecycle } from "./finder-lifecycle.js";
import {
	normalizeRoot,
	normalizeSlashes,
	type RootAuthorization,
	type RootedQuery,
} from "./root-authorization.js";

export const DEFAULT_GREP_LIMIT = 20;
export const DEFAULT_FIND_LIMIT = 30;
export const MAX_GREP_LIMIT = 50;
export const MAX_FIND_LIMIT = 200;
export const MAX_CONTEXT_LINES = 5;
export const MAX_OUTPUT_LINES = 600;
export const MAX_OUTPUT_BYTES = 256 * 1024;
export const GREP_MAX_LINE_LENGTH = 400;
const FIND_WEAK_SAMPLE_SIZE = 5;
const HOT_FRECENCY = 25;
const WARM_FRECENCY = 20;

export interface GrepParams {
	pattern: string;
	path?: string;
	exclude?: string | string[];
	caseSensitive?: boolean;
	context?: number;
	limit?: number;
	cursor?: string;
}

export interface FindParams {
	pattern: string;
	path?: string;
	exclude?: string | string[];
	limit?: number;
	cursor?: string;
}

export interface ToolResult {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
}

export type SearchFinder = Pick<FileFinderApi, "grep" | "fileSearch">;

export interface SearchToolDependencies {
	roots: RootAuthorization;
	finders: Pick<FinderLifecycle<any>, "ensure">;
	cursors: CursorStore;
}

interface GrepState {
	rooted: RootedQuery;
	cursor: GrepCursor;
}

interface FindState {
	rooted: RootedQuery;
	query: string;
	pageIndex: number;
}

function excludeList(exclude: string | string[] | undefined): string[] {
	if (!exclude) return [];
	return (Array.isArray(exclude) ? exclude : [exclude])
		.flatMap((value) => value.split(/[,\s]+/))
		.map((value) => value.trim())
		.filter(Boolean);
}

function assertIntegerBudget(
	name: string,
	value: number | undefined,
	fallback: number,
	maximum: number,
): number {
	const effective = value ?? fallback;
	if (!Number.isSafeInteger(effective) || effective < 1 || effective > maximum) {
		throw new Error(
			`${name} must be an integer from 1 to ${maximum}. Narrow the query and use the returned cursor for more results.`,
		);
	}
	return effective;
}

function assertContext(value: number | undefined): number {
	const effective = value ?? 0;
	if (!Number.isSafeInteger(effective) || effective < 0 || effective > MAX_CONTEXT_LINES) {
		throw new Error(
			`context must be an integer from 0 to ${MAX_CONTEXT_LINES}. Read the matched file for additional context.`,
		);
	}
	return effective;
}

function bindingFor(
	kind: "grep" | "find",
	params: GrepParams | FindParams,
	rooted: Pick<RootedQuery, "rootIdentity" | "rootGeneration">,
	limit: number,
	context: number,
	mode: string,
): CursorBinding {
	return {
		kind,
		rootIdentity: rooted.rootIdentity,
		rootGeneration: rooted.rootGeneration,
		pattern: params.pattern.trim(),
		path: params.path?.trim() ?? "",
		exclude: excludeList(params.exclude),
		caseSensitive: "caseSensitive" in params && params.caseSensitive === true,
		context,
		limit,
		mode,
	};
}

function boundedLines(lines: string[]): { output: string; truncated: boolean } {
	const marker = "[Formatted output budget reached; use the cursor or narrow the query.]";
	const markerBytes = Buffer.byteLength(`\n${marker}`);
	const output: string[] = [];
	let bytes = 0;
	let truncated = false;
	for (const line of lines) {
		if (output.length >= MAX_OUTPUT_LINES - 1) {
			truncated = true;
			break;
		}
		const addition = Buffer.byteLength(`${output.length ? "\n" : ""}${line}`);
		if (bytes + addition + markerBytes > MAX_OUTPUT_BYTES) {
			truncated = true;
			break;
		}
		output.push(line);
		bytes += addition;
	}
	if (truncated) output.push(marker);
	return { output: output.join("\n"), truncated };
}

function displayPath(root: string, relativePath: string, activeCwd: string): string {
	const relative = normalizeSlashes(relativePath);
	const shown =
		normalizeRoot(root) === normalizeRoot(activeCwd)
			? relative
			: normalizeSlashes(path.join(root, relative));
	return shown.length <= 1_000 ? shown : `${shown.slice(0, 997)}...`;
}

function truncateLine(line: string): string {
	const trimmed = line.trim();
	return trimmed.length <= GREP_MAX_LINE_LENGTH
		? trimmed
		: `${trimmed.slice(0, GREP_MAX_LINE_LENGTH)}...`;
}

export function fffFileAnnotation(item: {
	gitStatus?: string;
	totalFrecencyScore?: number;
	accessFrecencyScore?: number;
}): string {
	const git = item.gitStatus;
	if (git && git !== "clean" && git !== "unknown") return `  [${git} in git]`;
	const frecency = item.totalFrecencyScore ?? item.accessFrecencyScore ?? 0;
	if (frecency >= HOT_FRECENCY) return "  [VERY often touched file]";
	if (frecency >= WARM_FRECENCY) return "  [often touched file]";
	return "";
}

export function formatGrepOutput(
	result: GrepResult,
	root: string,
	activeCwd: string,
	globalLimit: number,
): { output: string; shownCount: number; capped: boolean; budgetCapped: boolean } {
	if (result.items.length === 0) {
		return { output: "No matches found", shownCount: 0, capped: false, budgetCapped: false };
	}
	const lines: string[] = [];
	let currentFile = "";
	let shown = 0;
	for (const match of result.items) {
		if (shown >= globalLimit) break;
		const shownPath = displayPath(root, match.relativePath, activeCwd);
		if (shownPath !== currentFile) {
			if (lines.length) lines.push("");
			currentFile = shownPath;
			lines.push(`${shownPath}${fffFileAnnotation(match)}`);
		}
		match.contextBefore?.forEach((line, index) => {
			lines.push(` ${match.lineNumber - match.contextBefore!.length + index}- ${truncateLine(line)}`);
		});
		lines.push(` ${match.lineNumber}: ${truncateLine(match.lineContent)}`);
		shown++;
		match.contextAfter?.forEach((line, index) => {
			lines.push(` ${match.lineNumber + 1 + index}- ${truncateLine(line)}`);
		});
	}
	const bounded = boundedLines(lines);
	return {
		output: bounded.output,
		shownCount: shown,
		capped: result.items.length > shown,
		budgetCapped: bounded.truncated,
	};
}

function weakScoreThreshold(pattern: string): number {
	return Math.floor((pattern.length * 12 * 50) / 100);
}

export function formatFindOutput(
	result: SearchResult,
	root: string,
	activeCwd: string,
	limit: number,
	pattern: string,
): { output: string; weak: boolean; shownCount: number; budgetCapped: boolean } {
	if (!result.items.length) {
		return { output: "No files found matching pattern", weak: false, shownCount: 0, budgetCapped: false };
	}
	const weak = (result.scores[0]?.total ?? 0) < weakScoreThreshold(pattern);
	const effective = weak ? Math.min(FIND_WEAK_SAMPLE_SIZE, limit) : limit;
	const shown = result.items.slice(0, effective);
	const bounded = boundedLines(
		shown.map((item) => `${displayPath(root, item.relativePath, activeCwd)}${fffFileAnnotation(item)}`),
	);
	return { output: bounded.output, weak, shownCount: shown.length, budgetCapped: bounded.truncated };
}

function regexMode(pattern: string): { mode: GrepMode; invalidNotice?: string } {
	const hasSyntax = pattern !== pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	if (!hasSyntax) return { mode: "plain" };
	try {
		new RegExp(pattern);
		return { mode: "regex" };
	} catch (error) {
		return {
			mode: "plain",
			invalidNotice: `Invalid regex; used literal match instead (${error instanceof Error ? error.message : String(error)}).`,
		};
	}
}

function wildcardOnly(pattern: string): boolean {
	return /^(?:[.^$]*(?:[.][*+?]|\*|\+)[.^$]*|[.^$\s]*|\.\*\??|\.\*[+?]?|\.\+\??|\.|\*|\?)$/.test(pattern.trim());
}

export async function executeGrep(
	params: GrepParams,
	signal: AbortSignal | undefined,
	deps: SearchToolDependencies,
): Promise<ToolResult> {
	if (signal?.aborted) throw new Error("Operation aborted. Retry the query if it is still needed.");
	const limit = assertIntegerBudget("limit", params.limit, DEFAULT_GREP_LIMIT, MAX_GREP_LIMIT);
	const context = assertContext(params.context);
	const detected = regexMode(params.pattern);
	if (wildcardOnly(params.pattern)) {
		return {
			content: [{ type: "text", text: `Pattern '${params.pattern}' matches everything — use a concrete substring or identifier.` }],
			details: { totalMatched: 0, totalFiles: 0 },
		};
	}

	let rooted: RootedQuery;
	let upstreamCursor: GrepCursor | null = null;
	if (params.cursor) {
		const record = deps.cursors.read<GrepState>(params.cursor);
		rooted = record.state.rooted;
		const expected = bindingFor("grep", params, {
			rootIdentity: rooted.rootIdentity,
			rootGeneration: deps.roots.generation,
		}, limit, context, detected.mode);
		upstreamCursor = deps.cursors.resume<GrepState>(params.cursor, expected).cursor;
	} else {
		rooted = deps.roots.resolve(params.path);
	}
	const finder = (await deps.finders.ensure(rooted.root)) as SearchFinder;
	const query = buildQuery(rooted.pathForQuery, params.pattern, params.exclude, rooted.root);
	const smartCase = params.caseSensitive !== true;
	const grepResult = finder.grep(query, {
		mode: detected.mode,
		smartCase,
		maxMatchesPerFile: Math.min(limit, 50),
		pageSize: limit,
		cursor: upstreamCursor,
		beforeContext: context,
		afterContext: context,
		classifyDefinitions: true,
	});
	if (!grepResult.ok) throw new Error(`FFF grep failed: ${grepResult.error}. Narrow the query or run /fff-rescan, then retry.`);

	let result = grepResult.value;
	let fuzzyNotice: string | undefined;
	if (!result.items.length && !params.cursor && detected.mode !== "regex") {
		const fuzzy = finder.grep(params.pattern, {
			mode: "fuzzy",
			smartCase,
			maxMatchesPerFile: Math.min(limit, 50),
			pageSize: limit,
			cursor: null,
			beforeContext: 0,
			afterContext: 0,
			classifyDefinitions: true,
		});
		if (fuzzy.ok && fuzzy.value.items.length) {
			fuzzyNotice = "0 exact matches. Maybe you meant this?";
			result = fuzzy.value;
		}
	}

	const formatted = formatGrepOutput(result, rooted.root, deps.roots.activeCwd, limit);
	let output = formatted.output;
	const notices: string[] = [];
	if (detected.invalidNotice) notices.push(detected.invalidNotice);
	if (result.regexFallbackError) notices.push(`Invalid regex: ${result.regexFallbackError}; used literal match.`);
	if (formatted.capped || formatted.budgetCapped) notices.push(`Output capped at ${formatted.shownCount} displayed matches by the documented global budget.`);
	if (rooted.searchedOutsideActiveCwd) notices.push(`Searched external root ${normalizeSlashes(rooted.root)}`);
	if (result.nextCursor) {
		const cursor = deps.cursors.store<GrepState>({
			binding: bindingFor("grep", params, rooted, limit, context, detected.mode),
			state: { rooted, cursor: result.nextCursor },
		});
		notices.push(`Continue with cursor="${cursor}" and the same query parameters`);
	}
	if (notices.length) output += `\n\n[${notices.join(" ")}]`;
	if (fuzzyNotice) output = `[${fuzzyNotice}]\n${output}`;
	return {
		content: [{ type: "text", text: output }],
		details: { totalMatched: result.totalMatched, totalFiles: result.totalFiles },
	};
}

export async function executeFind(
	params: FindParams,
	signal: AbortSignal | undefined,
	deps: SearchToolDependencies,
): Promise<ToolResult> {
	if (signal?.aborted) throw new Error("Operation aborted. Retry the query if it is still needed.");
	const limit = assertIntegerBudget("limit", params.limit, DEFAULT_FIND_LIMIT, MAX_FIND_LIMIT);
	let rooted: RootedQuery;
	let query: string;
	let pageIndex = 0;
	if (params.cursor) {
		const record = deps.cursors.read<FindState>(params.cursor);
		rooted = record.state.rooted;
		const expected = bindingFor("find", params, {
			rootIdentity: rooted.rootIdentity,
			rootGeneration: deps.roots.generation,
		}, limit, 0, "fuzzy");
		const state = deps.cursors.resume<FindState>(params.cursor, expected);
		query = state.query;
		pageIndex = state.pageIndex;
	} else {
		rooted = deps.roots.resolve(params.path);
		query = buildQuery(rooted.pathForQuery, params.pattern, params.exclude, rooted.root);
	}
	const finder = (await deps.finders.ensure(rooted.root)) as SearchFinder;
	const searchResult = finder.fileSearch(query, { pageIndex, pageSize: limit });
	if (!searchResult.ok) throw new Error(`FFF file search failed: ${searchResult.error}. Narrow the query or run /fff-rescan, then retry.`);
	const result = searchResult.value;
	const formatted = formatFindOutput(result, rooted.root, deps.roots.activeCwd, limit, params.pattern);
	let output = formatted.output;
	const shownSoFar = pageIndex * limit + result.items.length;
	const hasMore = result.items.length >= limit && result.totalMatched > shownSoFar;
	const notices: string[] = [];
	if (formatted.weak && formatted.shownCount) notices.push(`Query "${params.pattern}" produced only weak scattered fuzzy matches. Output capped at ${formatted.shownCount}/${result.totalMatched}; use a more specific path or pattern.`);
	if (formatted.budgetCapped) notices.push("Formatted output reached the documented byte/line budget.");
	if (rooted.searchedOutsideActiveCwd) notices.push(`Searched external root ${normalizeSlashes(rooted.root)}`);
	if (!formatted.weak && hasMore) {
		const cursor = deps.cursors.store<FindState>({
			binding: bindingFor("find", params, rooted, limit, 0, "fuzzy"),
			state: { rooted, query, pageIndex: pageIndex + 1 },
		});
		notices.push(`${result.totalMatched - shownSoFar} more matches available. Continue with cursor="${cursor}" and the same query parameters`);
	}
	if (notices.length) output += `\n\n[${notices.join(" ")}]`;
	return {
		content: [{ type: "text", text: output }],
		details: { totalMatched: result.totalMatched, totalFiles: result.totalFiles, pageIndex, hasMore },
	};
}

export const grepSchema = Type.Object({
	pattern: Type.String({ description: "Search pattern (literal text or regex)", minLength: 1 }),
	path: Type.Optional(Type.String({ description: "Repo-relative path constraint, glob, or absolute path inside a configured FFF root." })),
	exclude: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())], { description: "Exclude paths, comma/space-separated or array." })),
	caseSensitive: Type.Optional(Type.Boolean({ description: "Force case-sensitive matching. Default uses smart-case." })),
	context: Type.Optional(Type.Integer({ minimum: 0, maximum: MAX_CONTEXT_LINES, description: `Context lines before and after each match (maximum ${MAX_CONTEXT_LINES})` })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_GREP_LIMIT, description: `Global max matches (default ${DEFAULT_GREP_LIMIT}, maximum ${MAX_GREP_LIMIT})` })),
	cursor: Type.Optional(Type.String({ description: "Pagination cursor; repeat all original query parameters" })),
});

export const findSchema = Type.Object({
	pattern: Type.String({ description: "Fuzzy filename/path search. Use '*' with path:'dir/**' to list a directory.", minLength: 1 }),
	path: Type.Optional(Type.String({ description: "Repo-relative path constraint, glob, or absolute path inside a configured FFF root." })),
	exclude: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())], { description: "Exclude paths, comma/space-separated or array." })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_FIND_LIMIT, description: `Max results per page (default ${DEFAULT_FIND_LIMIT}, maximum ${MAX_FIND_LIMIT})` })),
	cursor: Type.Optional(Type.String({ description: "Pagination cursor; repeat all original query parameters" })),
});
