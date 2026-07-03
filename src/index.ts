/**
 * pi-fff-plus: T50-friendly FFF search extension for pi.
 *
 * Based on @ff-labs/pi-fff, with safer Windows paths, absolute-path support,
 * optional multi-root search, slash-normalized output, and true global grep caps.
 */

import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	type AutocompleteItem,
	type AutocompleteProvider,
	Text,
} from "@earendil-works/pi-tui";
import type {
	GrepCursor,
	GrepMode,
	GrepResult,
	MixedItem,
	SearchResult,
} from "@ff-labs/fff-node";
import { FileFinder } from "@ff-labs/fff-node";
import { Type } from "@sinclair/typebox";
import { buildQuery } from "./query.js";

const DEFAULT_GREP_LIMIT = 20;
const DEFAULT_FIND_LIMIT = 30;
const GREP_MAX_LINE_LENGTH = 500;
const MENTION_MAX_RESULTS = 20;
const FIND_WEAK_SAMPLE_SIZE = 5;
const HOT_FRECENCY = 25;
const WARM_FRECENCY = 20;

type FffMode = "tools-and-ui" | "tools-only" | "override";
const VALID_MODES: FffMode[] = ["tools-and-ui", "tools-only", "override"];

interface ToolNames {
	grep: string;
	find: string;
	multiGrep: string;
}

const FFF_TOOL_NAMES: ToolNames = {
	grep: "ffgrep",
	find: "fffind",
	multiGrep: "fff-multi-grep",
};
const OVERRIDE_TOOL_NAMES: ToolNames = {
	grep: "grep",
	find: "find",
	multiGrep: "multi_grep",
};

interface FinderEntry {
	finder: FileFinder | null;
	promise: Promise<FileFinder> | null;
}

interface GrepCursorEntry {
	root: string;
	cursor: GrepCursor;
}

interface FindCursor {
	root: string;
	query: string;
	pattern: string;
	pageSize: number;
	nextPageIndex: number;
}

interface RootedQuery {
	root: string;
	pathForQuery?: string;
	searchedOutsideActiveCwd: boolean;
}

function resolveToolNames(mode: FffMode): ToolNames {
	return mode === "override" ? OVERRIDE_TOOL_NAMES : FFF_TOOL_NAMES;
}

function normalizeSlashes(value: string): string {
	return value.replaceAll("\\", "/");
}

function normalizeRoot(value: string): string {
	return path.resolve(value).replace(/[\\/]+$/, "");
}

function uniqueRoots(roots: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of roots) {
		if (!raw.trim()) continue;
		const root = normalizeRoot(raw.trim());
		const key = process.platform === "win32" ? root.toLowerCase() : root;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(root);
	}
	return out;
}

function splitRootList(value: string | undefined): string[] {
	if (!value) return [];
	return value
		.split(/[;,]/)
		.map((part) => part.trim())
		.filter(Boolean);
}

function defaultExtraRoots(): string[] {
	const home = os.homedir();
	const appData = process.env.APPDATA;
	return uniqueRoots([
		"C:/dev/pi",
		path.join(home, ".pi", "agent"),
		path.join(home, ".agents"),
		...(appData ? [path.join(appData, "npm")] : []),
	]);
}

function isSameOrInside(candidate: string, root: string): boolean {
	const relative = path.relative(root, candidate);
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	);
}

function findContainingRoot(absPath: string, roots: string[]): string | null {
	const normalized = normalizeRoot(absPath);
	return (
		roots
			.filter((root) => isSameOrInside(normalized, root))
			.sort((a, b) => b.length - a.length)[0] ?? null
	);
}

function displayPath(
	root: string,
	relativePath: string,
	activeCwd: string,
): string {
	const relative = normalizeSlashes(relativePath);
	if (normalizeRoot(root) === normalizeRoot(activeCwd)) return relative;
	return normalizeSlashes(path.join(root, relative));
}

function truncateLine(line: string, max = GREP_MAX_LINE_LENGTH): string {
	const trimmed = line.trim();
	return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}...`;
}

export function fffFileAnnotation(item: {
	gitStatus?: string;
	totalFrecencyScore?: number;
	accessFrecencyScore?: number;
}): string {
	const git = item.gitStatus;
	if (git && git !== "clean" && git !== "unknown" && git !== "") {
		return `  [${git} in git]`;
	}
	const frecency = item.totalFrecencyScore ?? item.accessFrecencyScore ?? 0;
	if (frecency >= HOT_FRECENCY) return "  [VERY often touched file]";
	if (frecency >= WARM_FRECENCY) return "  [often touched file]";
	return "";
}

function formatGrepOutput(
	result: GrepResult,
	root: string,
	activeCwd: string,
	globalLimit: number,
): { output: string; shownCount: number; capped: boolean } {
	if (result.items.length === 0) {
		return { output: "No matches found", shownCount: 0, capped: false };
	}

	const lines: string[] = [];
	let currentFile = "";
	let shown = 0;

	for (const match of result.items) {
		if (shown >= globalLimit) break;

		const shownPath = displayPath(root, match.relativePath, activeCwd);
		if (shownPath !== currentFile) {
			if (lines.length > 0) lines.push("");
			currentFile = shownPath;
			lines.push(`${shownPath}${fffFileAnnotation(match)}`);
		}

		match.contextBefore?.forEach((line: string, i: number) => {
			const lineNum = match.lineNumber - match.contextBefore!.length + i;
			lines.push(` ${lineNum}- ${truncateLine(line)}`);
		});
		lines.push(` ${match.lineNumber}: ${truncateLine(match.lineContent)}`);
		shown++;
		match.contextAfter?.forEach((line: string, i: number) => {
			const lineNum = match.lineNumber + 1 + i;
			lines.push(` ${lineNum}- ${truncateLine(line)}`);
		});
	}

	return {
		output: lines.join("\n"),
		shownCount: shown,
		capped: result.items.length > shown,
	};
}

function weakScoreThreshold(pattern: string): number {
	const perfect = pattern.length * 12;
	return Math.floor((perfect * 50) / 100);
}

function formatFindOutput(
	result: SearchResult,
	root: string,
	activeCwd: string,
	limit: number,
	pattern: string,
): { output: string; weak: boolean; shownCount: number } {
	if (result.items.length === 0) {
		return {
			output: "No files found matching pattern",
			weak: false,
			shownCount: 0,
		};
	}

	const topScore = result.scores[0]?.total ?? 0;
	const weak = topScore < weakScoreThreshold(pattern);
	const effective = weak ? Math.min(FIND_WEAK_SAMPLE_SIZE, limit) : limit;
	const shown = result.items.slice(0, effective);

	return {
		output: shown
			.map(
				(item) =>
					`${displayPath(root, item.relativePath, activeCwd)}${fffFileAnnotation(item)}`,
			)
			.join("\n"),
		weak,
		shownCount: shown.length,
	};
}

function extractAtPrefix(textBeforeCursor: string): string | null {
	const match = textBeforeCursor.match(/(?:^|[ \t])(@(?:"[^"]*|[^\s]*))$/);
	return match?.[1] ?? null;
}

function buildAtCompletionValue(itemPath: string): string {
	const normalized = normalizeSlashes(itemPath);
	return normalized.includes(" ") ? `@"${normalized}"` : `@${normalized}`;
}

function createFffMentionProvider(
	getItems: (query: string, signal: AbortSignal) => Promise<AutocompleteItem[]>,
): AutocompleteProvider {
	return {
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const currentLine = lines[cursorLine] || "";
			const prefix = extractAtPrefix(currentLine.slice(0, cursorCol));
			if (!prefix || options.signal.aborted) return null;
			const query = prefix.startsWith('@"') ? prefix.slice(2) : prefix.slice(1);
			const items = await getItems(query, options.signal);
			return options.signal.aborted || items.length === 0
				? null
				: { items, prefix };
		},
		applyCompletion(_lines, cursorLine, cursorCol, item, prefix) {
			const currentLine = _lines[cursorLine] || "";
			const before = currentLine.slice(0, cursorCol - prefix.length);
			const after = currentLine.slice(cursorCol);
			const newLine = before + item.value + after;
			return {
				lines: [
					..._lines.slice(0, cursorLine),
					newLine,
					..._lines.slice(cursorLine + 1),
				],
				cursorLine,
				cursorCol: cursorCol - prefix.length + item.value.length,
			};
		},
	};
}

export default function fffPlusExtension(pi: ExtensionAPI) {
	const finders = new Map<string, FinderEntry>();
	let activeCwd = process.cwd();
	let knownRoots = uniqueRoots([
		activeCwd,
		...defaultExtraRoots(),
		...splitRootList(process.env.PI_FFF_ROOTS),
	]);

	let currentMode: FffMode =
		(pi.getFlag("fff-mode") as FffMode) ??
		(process.env.PI_FFF_MODE as FffMode) ??
		"tools-and-ui";
	const toolNames = resolveToolNames(currentMode);

	const frecencyDbPath =
		(pi.getFlag("fff-frecency-db") as string | undefined) ??
		process.env.FFF_FRECENCY_DB ??
		undefined;
	const historyDbPath =
		(pi.getFlag("fff-history-db") as string | undefined) ??
		process.env.FFF_HISTORY_DB ??
		undefined;

	function resolveBoolOpt(flagName: string, envName: string): boolean {
		const flag = pi.getFlag(flagName);
		if (typeof flag === "boolean") return flag;
		if (typeof flag === "string") return flag === "true" || flag === "1";
		const env = process.env[envName];
		return env === "1" || env === "true";
	}

	const enableFsRootScanning = resolveBoolOpt(
		"fff-enable-root-scan",
		"FFF_ENABLE_ROOT_SCAN",
	);

	const cursorCache = new Map<string, GrepCursorEntry>();
	let cursorCounter = 0;
	const findCursorCache = new Map<string, FindCursor>();
	let findCursorCounter = 0;

	function storeCursor(entry: GrepCursorEntry): string {
		const id = `fff_c${++cursorCounter}`;
		cursorCache.set(id, entry);
		if (cursorCache.size > 200)
			cursorCache.delete(cursorCache.keys().next().value!);
		return id;
	}

	function storeFindCursor(cursor: FindCursor): string {
		const id = `${++findCursorCounter}`;
		findCursorCache.set(id, cursor);
		if (findCursorCache.size > 200)
			findCursorCache.delete(findCursorCache.keys().next().value!);
		return id;
	}

	function refreshKnownRoots(cwd: string): void {
		activeCwd = normalizeRoot(cwd);
		knownRoots = uniqueRoots([
			activeCwd,
			...defaultExtraRoots(),
			...splitRootList(process.env.PI_FFF_ROOTS),
		]);
	}

	function absoluteRootCandidate(absInput: string): {
		root: string;
		pathForQuery?: string;
	} {
		const slashInput = normalizeSlashes(absInput);
		const globIndex = slashInput.search(/[*?[{]/);
		const nonGlobPart =
			globIndex === -1 ? slashInput : slashInput.slice(0, globIndex);
		const lastSlash = nonGlobPart.lastIndexOf("/");
		const basePart =
			globIndex === -1
				? slashInput
				: nonGlobPart.slice(0, Math.max(0, lastSlash));
		const normalizedBase = normalizeRoot(basePart || slashInput);

		try {
			if (existsSync(normalizedBase)) {
				const stat = statSync(normalizedBase);
				if (stat.isDirectory()) {
					const rest =
						globIndex === -1
							? ""
							: slashInput
									.slice(normalizeSlashes(normalizedBase).length)
									.replace(/^\/+/, "");
					return { root: normalizedBase, pathForQuery: rest || undefined };
				}
				return {
					root: path.dirname(normalizedBase),
					pathForQuery: path.basename(normalizedBase),
				};
			}
		} catch {
			// Fall back to configured-root handling below.
		}

		const containingRoot = findContainingRoot(absInput, knownRoots);
		if (!containingRoot) return { root: normalizeRoot(absInput) };
		const relative = path.relative(containingRoot, absInput);
		return {
			root: containingRoot,
			pathForQuery: relative === "" ? undefined : normalizeSlashes(relative),
		};
	}

	function resolveRootedQuery(rawPath?: string): RootedQuery {
		if (!rawPath) {
			return { root: activeCwd, searchedOutsideActiveCwd: false };
		}

		const trimmed = rawPath.trim();
		if (!path.isAbsolute(trimmed)) {
			return {
				root: activeCwd,
				pathForQuery: trimmed,
				searchedOutsideActiveCwd: false,
			};
		}

		const candidate = absoluteRootCandidate(trimmed);
		const allowedRoot = findContainingRoot(candidate.root, knownRoots);
		if (!allowedRoot) {
			throw new Error(
				`Path is outside configured FFF roots: ${normalizeSlashes(trimmed)}. ` +
					`Configured roots: ${knownRoots.map(normalizeSlashes).join(", ")}. ` +
					`Set PI_FFF_ROOTS="root1;root2" to add more.`,
			);
		}

		return {
			root: candidate.root,
			pathForQuery: candidate.pathForQuery,
			searchedOutsideActiveCwd:
				normalizeRoot(candidate.root) !== normalizeRoot(activeCwd),
		};
	}

	async function ensureFinder(root: string): Promise<FileFinder> {
		const normalizedRoot = normalizeRoot(root);
		let entry = finders.get(normalizedRoot);
		if (entry?.finder && !entry.finder.isDestroyed) return entry.finder;
		if (entry?.promise) return entry.promise;

		entry = { finder: null, promise: null };
		finders.set(normalizedRoot, entry);

		entry.promise = (async () => {
			const result = FileFinder.create({
				basePath: normalizedRoot,
				frecencyDbPath,
				historyDbPath,
				aiMode: true,
				enableHomeDirScanning: true,
				enableFsRootScanning,
			});
			if (!result.ok)
				throw new Error(
					`Failed to create FFF file finder for ${normalizeSlashes(normalizedRoot)}: ${result.error}`,
				);
			entry!.finder = result.value;
			await result.value.waitForScan(15000);
			return result.value;
		})().finally(() => {
			entry!.promise = null;
		});

		return entry.promise;
	}

	function destroyFinders(): void {
		for (const entry of finders.values()) {
			if (entry.finder && !entry.finder.isDestroyed) entry.finder.destroy();
		}
		finders.clear();
	}

	function shouldEnableMentions(): boolean {
		return currentMode !== "tools-only";
	}

	async function getMentionItems(
		query: string,
		signal: AbortSignal,
	): Promise<AutocompleteItem[]> {
		if (signal.aborted) return [];
		const f = await ensureFinder(activeCwd);
		if (signal.aborted) return [];
		const result = f.mixedSearch(query, { pageSize: MENTION_MAX_RESULTS });
		if (!result.ok) return [];

		return result.value.items
			.slice(0, MENTION_MAX_RESULTS)
			.map((mixed: MixedItem) => {
				if (mixed.type === "directory") {
					return {
						value: buildAtCompletionValue(mixed.item.relativePath),
						label: mixed.item.dirName,
						description: normalizeSlashes(mixed.item.relativePath),
					};
				}
				return {
					value: buildAtCompletionValue(mixed.item.relativePath),
					label: mixed.item.fileName,
					description: normalizeSlashes(mixed.item.relativePath),
				};
			});
	}

	function registerAutocompleteProvider(ctx: {
		ui: {
			addAutocompleteProvider: (
				factory: (current: AutocompleteProvider) => AutocompleteProvider,
			) => void;
		};
	}) {
		ctx.ui.addAutocompleteProvider((current) => {
			const mentionProvider = createFffMentionProvider(getMentionItems);
			return {
				async getSuggestions(lines, cursorLine, cursorCol, options) {
					if (shouldEnableMentions()) {
						try {
							const mentionResult = await mentionProvider.getSuggestions(
								lines,
								cursorLine,
								cursorCol,
								options,
							);
							if (mentionResult) return mentionResult;
						} catch {
							// Delegate when FFF lookup is unavailable.
						}
					}
					return current.getSuggestions(lines, cursorLine, cursorCol, options);
				},
				applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
					return current.applyCompletion(
						lines,
						cursorLine,
						cursorCol,
						item,
						prefix,
					);
				},
				shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
					return (
						current.shouldTriggerFileCompletion?.(
							lines,
							cursorLine,
							cursorCol,
						) ?? true
					);
				},
			};
		});
	}

	pi.registerFlag("fff-mode", {
		description: "FFF mode: tools-and-ui | tools-only | override",
		type: "string",
	});
	pi.registerFlag("fff-frecency-db", {
		description: "Path to the frecency database",
		type: "string",
	});
	pi.registerFlag("fff-history-db", {
		description: "Path to the query history database",
		type: "string",
	});
	pi.registerFlag("fff-enable-root-scan", {
		description: "Allow indexing filesystem root",
		type: "boolean",
	});

	pi.on("session_start", async (_event, ctx) => {
		try {
			refreshKnownRoots(ctx.cwd);
			const entries = ctx.sessionManager?.getEntries();
			const modeEntry = entries
				? [...entries]
						.reverse()
						.find(
							(e: { type: string; customType?: string }) =>
								e.type === "custom" && e.customType === "fff-mode",
						)
				: undefined;
			if (
				modeEntry &&
				typeof (modeEntry as any).data?.mode === "string" &&
				VALID_MODES.includes((modeEntry as any).data.mode as FffMode)
			) {
				currentMode = (modeEntry as any).data.mode as FffMode;
			}
			registerAutocompleteProvider(ctx);
			await ensureFinder(activeCwd);
		} catch (e: unknown) {
			ctx.ui.notify(
				`FFF+ init failed: ${e instanceof Error ? e.message : String(e)}`,
				"error",
			);
		}
	});

	pi.on("session_shutdown", async () => {
		destroyFinders();
	});

	const renderTextResult = (
		result: { content?: { type: string; text?: string }[] },
		options: { expanded?: boolean },
		theme: any,
		context: any,
		maxLines = 15,
	) => {
		const text =
			(context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		const output =
			result.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
		if (!output) {
			text.setText(theme.fg("muted", "No output"));
			return text;
		}
		const lines = output.split("\n");
		const displayLines = lines.slice(
			0,
			options.expanded ? lines.length : maxLines,
		);
		let content = `\n${displayLines.map((line: string) => theme.fg("toolOutput", line)).join("\n")}`;
		if (lines.length > displayLines.length) {
			content += theme.fg(
				"muted",
				`\n... (${lines.length - displayLines.length} more lines)`,
			);
		}
		text.setText(content);
		return text;
	};

	const grepSchema = Type.Object({
		pattern: Type.String({
			description: "Search pattern (literal text or regex)",
		}),
		path: Type.Optional(
			Type.String({
				description:
					"Repo-relative path constraint, glob, or absolute path inside a configured FFF root.",
			}),
		),
		exclude: Type.Optional(
			Type.Union([Type.String(), Type.Array(Type.String())], {
				description: "Exclude paths, comma/space-separated or array.",
			}),
		),
		caseSensitive: Type.Optional(
			Type.Boolean({
				description: "Force case-sensitive matching. Default uses smart-case.",
			}),
		),
		context: Type.Optional(
			Type.Number({ description: "Context lines before+after each match" }),
		),
		limit: Type.Optional(
			Type.Number({
				description: `Global max matches (default ${DEFAULT_GREP_LIMIT})`,
			}),
		),
		cursor: Type.Optional(
			Type.String({ description: "Pagination cursor from previous result" }),
		),
	});

	pi.registerTool({
		name: toolNames.grep,
		label: toolNames.grep,
		description: `Grep file contents with FFF+. Accepts absolute paths inside configured roots. Default global limit ${DEFAULT_GREP_LIMIT}.`,
		promptSnippet: "Grep contents",
		promptGuidelines: [
			"Prefer bare identifiers as patterns. Literal queries are most efficient.",
			"Absolute paths are allowed when inside configured roots: cwd, C:/dev/pi, ~/.pi/agent, ~/.agents, or PI_FFF_ROOTS.",
			"Use path for include and exclude for noise.",
			"After 1-2 greps, read the top match instead of more greps.",
		],
		parameters: grepSchema,
		async execute(_toolCallId, params, signal) {
			if (signal?.aborted) throw new Error("Operation aborted");

			const resumed = params.cursor
				? cursorCache.get(params.cursor)
				: undefined;
			const rooted = resumed
				? {
						root: resumed.root,
						pathForQuery: undefined,
						searchedOutsideActiveCwd:
							normalizeRoot(resumed.root) !== normalizeRoot(activeCwd),
					}
				: resolveRootedQuery(params.path);
			const f = await ensureFinder(rooted.root);
			const effectiveLimit = Math.max(1, params.limit ?? DEFAULT_GREP_LIMIT);
			const query = resumed
				? params.pattern
				: buildQuery(
						rooted.pathForQuery,
						params.pattern,
						params.exclude,
						rooted.root,
					);

			const hasRegexSyntax =
				params.pattern !==
				params.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			let mode: GrepMode = hasRegexSyntax ? "regex" : "plain";
			if (mode === "regex") {
				try {
					new RegExp(params.pattern);
				} catch {
					mode = "plain";
				}
			}

			const p = params.pattern.trim();
			const isWildcardOnly =
				hasRegexSyntax &&
				/^(?:[.^$]*(?:[.][*+?]|\*|\+)[.^$]*|[.^$\s]*|\.\*\??|\.\*[+?]?|\.\+\??|\.|\*|\?)$/.test(
					p,
				);
			if (isWildcardOnly) {
				return {
					content: [
						{
							type: "text",
							text: `Pattern '${params.pattern}' matches everything — grep needs a concrete substring or identifier.`,
						},
					],
					details: { totalMatched: 0, totalFiles: 0 },
				};
			}

			const smartCase = params.caseSensitive !== true;
			const grepResult = f.grep(query, {
				mode,
				smartCase,
				maxMatchesPerFile: Math.min(effectiveLimit, 50),
				cursor: resumed?.cursor ?? null,
				beforeContext: params.context ?? 0,
				afterContext: params.context ?? 0,
				classifyDefinitions: true,
			});
			if (!grepResult.ok) throw new Error(grepResult.error);

			let result = grepResult.value;
			let fuzzyNotice: string | null = null;
			if (result.items.length === 0 && !params.cursor && mode !== "regex") {
				const fuzzy = f.grep(params.pattern, {
					mode: "fuzzy",
					smartCase,
					maxMatchesPerFile: Math.min(effectiveLimit, 50),
					cursor: null,
					beforeContext: 0,
					afterContext: 0,
					classifyDefinitions: true,
				});
				if (fuzzy.ok && fuzzy.value.items.length > 0) {
					fuzzyNotice = "0 exact matches. Maybe you meant this?";
					result = fuzzy.value;
				}
			}

			const formatted = formatGrepOutput(
				result,
				rooted.root,
				activeCwd,
				effectiveLimit,
			);
			let output = formatted.output;
			const notices: string[] = [];
			if (result.regexFallbackError)
				notices.push(
					`Invalid regex: ${result.regexFallbackError}, used literal match`,
				);
			if (formatted.capped)
				notices.push(
					`Output capped at ${formatted.shownCount}/${result.items.length} returned matches by global limit=${effectiveLimit}`,
				);
			if (rooted.searchedOutsideActiveCwd)
				notices.push(`Searched external root ${normalizeSlashes(rooted.root)}`);
			if (result.nextCursor)
				notices.push(
					`Continue with cursor="${storeCursor({ root: rooted.root, cursor: result.nextCursor })}"`,
				);
			if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;
			if (fuzzyNotice) output = `[${fuzzyNotice}]\n${output}`;

			return {
				content: [{ type: "text", text: output }],
				details: {
					totalMatched: result.totalMatched,
					totalFiles: result.totalFiles,
				},
			};
		},
		renderCall(args, theme, context) {
			const text =
				(context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(
				theme.fg("toolTitle", theme.bold(toolNames.grep)) +
					" " +
					theme.fg("accent", `/${args?.pattern ?? ""}/`) +
					theme.fg("toolOutput", ` in ${args?.path ?? "."}`),
			);
			return text;
		},
		renderResult(result, options, theme, context) {
			return renderTextResult(result, options, theme, context, 15);
		},
	});

	const findSchema = Type.Object({
		pattern: Type.String({
			description:
				"Fuzzy filename/path search. Use '*' with path:'dir/**' to list a directory.",
		}),
		path: Type.Optional(
			Type.String({
				description:
					"Repo-relative path constraint, glob, or absolute path inside a configured FFF root.",
			}),
		),
		exclude: Type.Optional(
			Type.Union([Type.String(), Type.Array(Type.String())], {
				description: "Exclude paths, comma/space-separated or array.",
			}),
		),
		limit: Type.Optional(
			Type.Number({
				description: `Max results per page (default ${DEFAULT_FIND_LIMIT})`,
			}),
		),
		cursor: Type.Optional(
			Type.String({ description: "Pagination cursor from previous result" }),
		),
	});

	pi.registerTool({
		name: toolNames.find,
		label: toolNames.find,
		description: `FFF+ fuzzy path search. Accepts absolute paths inside configured roots. Default limit ${DEFAULT_FIND_LIMIT}.`,
		promptSnippet: "Find files by path or glob",
		promptGuidelines: [
			"Use for paths, not content. Use grep for content.",
			"Absolute paths are allowed when inside configured roots.",
			"For exact path matches use a glob in path.",
			"To list a directory, use pattern:'*' with path:'dir/**'.",
		],
		parameters: findSchema,
		async execute(_toolCallId, params, signal) {
			if (signal?.aborted) throw new Error("Operation aborted");

			const resumed = params.cursor
				? findCursorCache.get(params.cursor)
				: undefined;
			const rooted = resumed
				? {
						root: resumed.root,
						pathForQuery: undefined,
						searchedOutsideActiveCwd:
							normalizeRoot(resumed.root) !== normalizeRoot(activeCwd),
					}
				: resolveRootedQuery(params.path);
			const f = await ensureFinder(rooted.root);
			const effectiveLimit = resumed
				? resumed.pageSize
				: Math.max(1, params.limit ?? DEFAULT_FIND_LIMIT);
			const query = resumed
				? resumed.query
				: buildQuery(
						rooted.pathForQuery,
						params.pattern,
						params.exclude,
						rooted.root,
					);
			const pattern = resumed ? resumed.pattern : params.pattern;
			const pageIndex = resumed?.nextPageIndex ?? 0;

			const searchResult = f.fileSearch(query, {
				pageIndex,
				pageSize: effectiveLimit,
			});
			if (!searchResult.ok) throw new Error(searchResult.error);

			const result = searchResult.value;
			const formatted = formatFindOutput(
				result,
				rooted.root,
				activeCwd,
				effectiveLimit,
				pattern,
			);
			let output = formatted.output;
			const shownSoFar = pageIndex * effectiveLimit + result.items.length;
			const hasMore =
				result.items.length >= effectiveLimit &&
				result.totalMatched > shownSoFar;
			const notices: string[] = [];
			if (formatted.weak && formatted.shownCount > 0)
				notices.push(
					`Query "${pattern}" produced only weak scattered fuzzy matches. Output capped at ${formatted.shownCount}/${result.totalMatched}.`,
				);
			if (rooted.searchedOutsideActiveCwd)
				notices.push(`Searched external root ${normalizeSlashes(rooted.root)}`);
			if (!formatted.weak && hasMore) {
				const remaining = result.totalMatched - shownSoFar;
				const cursorId = storeFindCursor({
					root: rooted.root,
					query,
					pattern,
					pageSize: effectiveLimit,
					nextPageIndex: pageIndex + 1,
				});
				notices.push(
					`${remaining} more match${remaining === 1 ? "" : "es"} available. cursor="${cursorId}" to continue`,
				);
			}
			if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;

			return {
				content: [{ type: "text", text: output }],
				details: {
					totalMatched: result.totalMatched,
					totalFiles: result.totalFiles,
					pageIndex,
					hasMore,
				},
			};
		},
		renderCall(args, theme, context) {
			const text =
				(context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(
				theme.fg("toolTitle", theme.bold(toolNames.find)) +
					" " +
					theme.fg("accent", args?.pattern ?? "") +
					theme.fg("toolOutput", ` in ${args?.path ?? "."}`),
			);
			return text;
		},
		renderResult(result, options, theme, context) {
			return renderTextResult(result, options, theme, context, 20);
		},
	});

	pi.registerCommand("fff-mode", {
		description:
			"Show or set FFF mode: /fff-mode [tools-and-ui | tools-only | override]",
		handler: async (args, ctx) => {
			const arg = (args || "").trim();
			if (!arg) {
				ctx.ui.notify(`Current mode: '${currentMode}'`, "info");
				return;
			}
			if (!VALID_MODES.includes(arg as FffMode)) {
				ctx.ui.notify(
					`Usage: /fff-mode [${VALID_MODES.join(" | ")}]`,
					"warning",
				);
				return;
			}
			const oldMode = currentMode;
			currentMode = arg as FffMode;
			pi.appendEntry("fff-mode", { mode: currentMode });
			const note =
				(oldMode === "override") !== (currentMode === "override")
					? " (tool name change requires /reload)"
					: "";
			ctx.ui.notify(
				`Mode changed: '${oldMode}' → '${currentMode}'${note}`,
				"info",
			);
		},
	});

	pi.registerCommand("fff-health", {
		description: "Show FFF+ file finder health and configured roots",
		handler: async (_args, ctx) => {
			const lines = [
				`FFF+ mode: ${currentMode}`,
				`Active cwd: ${normalizeSlashes(activeCwd)}`,
				`Configured roots:`,
			];
			for (const root of knownRoots) {
				const entry = finders.get(normalizeRoot(root));
				if (!entry?.finder || entry.finder.isDestroyed) {
					lines.push(`- ${normalizeSlashes(root)}: not initialized`);
					continue;
				}
				const health = entry.finder.healthCheck();
				if (!health.ok)
					lines.push(
						`- ${normalizeSlashes(root)}: health failed: ${health.error}`,
					);
				else
					lines.push(
						`- ${normalizeSlashes(root)}: ${health.value.filePicker.indexedFiles ?? 0} files`,
					);
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("fff-rescan", {
		description: "Trigger FFF+ to rescan initialized roots",
		handler: async (_args, ctx) => {
			let count = 0;
			for (const entry of finders.values()) {
				if (!entry.finder || entry.finder.isDestroyed) continue;
				const result = entry.finder.scanFiles();
				if (result.ok) count++;
			}
			ctx.ui.notify(
				`FFF+ rescan triggered for ${count} initialized root${count === 1 ? "" : "s"}`,
				"info",
			);
		},
	});
}
