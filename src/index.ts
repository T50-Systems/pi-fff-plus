/**
 * pi-fff-plus: T50-friendly FFF search extension for Pi.
 *
 * Pi registration and UI composition live here. Root authorization, finder
 * lifecycle, cursor contracts, budgets, and tool execution are isolated in
 * testable modules without a Pi UI dependency.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	type AutocompleteItem,
	type AutocompleteProvider,
	Text,
} from "@earendil-works/pi-tui";
import { FileFinder, type MixedItem } from "@ff-labs/fff-node";
import { CursorStore } from "./cursors.js";
import { FinderLifecycle } from "./finder-lifecycle.js";
import {
	defaultExtraRoots,
	normalizeSlashes,
	RootAuthorization,
	splitRootList,
} from "./root-authorization.js";
import {
	DEFAULT_FIND_LIMIT,
	DEFAULT_GREP_LIMIT,
	executeFind,
	executeGrep,
	findSchema,
	grepSchema,
} from "./tools.js";

const MENTION_MAX_RESULTS = 20;
type FffMode = "tools-and-ui" | "tools-only" | "override";
const VALID_MODES: readonly FffMode[] = ["tools-and-ui", "tools-only", "override"];

interface ToolNames {
	grep: string;
	find: string;
}

function resolveToolNames(mode: FffMode): ToolNames {
	return mode === "override"
		? { grep: "grep", find: "find" }
		: { grep: "ffgrep", find: "fffind" };
}

function restoreFffMode(
	entries: readonly unknown[] | undefined,
	fallback: FffMode,
): FffMode {
	if (!entries) return fallback;
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (!entry || typeof entry !== "object") continue;
		const candidate = entry as {
			type?: unknown;
			customType?: unknown;
			data?: { mode?: unknown } | null;
		};
		if (candidate.type !== "custom" || candidate.customType !== "fff-mode") continue;
		const mode = candidate.data?.mode;
		if (typeof mode === "string" && VALID_MODES.includes(mode as FffMode)) {
			return mode as FffMode;
		}
	}
	return fallback;
}

function extractAtPrefix(textBeforeCursor: string): string | null {
	return textBeforeCursor.match(/(?:^|[ \t])(@(?:"[^"]*|[^\s]*))$/)?.[1] ?? null;
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
			const prefix = extractAtPrefix((lines[cursorLine] || "").slice(0, cursorCol));
			if (!prefix || options.signal.aborted) return null;
			const query = prefix.startsWith('@"') ? prefix.slice(2) : prefix.slice(1);
			const items = await getItems(query, options.signal);
			return options.signal.aborted || !items.length ? null : { items, prefix };
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			const currentLine = lines[cursorLine] || "";
			const newLine =
				currentLine.slice(0, cursorCol - prefix.length) +
				item.value +
				currentLine.slice(cursorCol);
			return {
				lines: [...lines.slice(0, cursorLine), newLine, ...lines.slice(cursorLine + 1)],
				cursorLine,
				cursorCol: cursorCol - prefix.length + item.value.length,
			};
		},
	};
}

export default function fffPlusExtension(pi: ExtensionAPI) {
	let currentMode: FffMode =
		(pi.getFlag("fff-mode") as FffMode) ??
		(process.env.PI_FFF_MODE as FffMode) ??
		"tools-and-ui";
	const toolNames = resolveToolNames(currentMode);
	const cursors = new CursorStore();
	const roots = new RootAuthorization({
		extraRoots: [
			...defaultExtraRoots(),
			...splitRootList(process.env.PI_FFF_ROOTS),
		],
	});

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
		return process.env[envName] === "1" || process.env[envName] === "true";
	}
	const enableFsRootScanning = resolveBoolOpt(
		"fff-enable-root-scan",
		"FFF_ENABLE_ROOT_SCAN",
	);

	const finders = new FinderLifecycle<FileFinder>(async (root) => {
		const result = FileFinder.create({
			basePath: root,
			frecencyDbPath,
			historyDbPath,
			aiMode: true,
			enableHomeDirScanning: true,
			enableFsRootScanning,
		});
		if (!result.ok) throw new Error(result.error);
		return result.value;
	}, 15_000, () => cursors.clear());
	const toolDeps = { roots, finders, cursors };

	async function getMentionItems(
		query: string,
		signal: AbortSignal,
	): Promise<AutocompleteItem[]> {
		if (signal.aborted) return [];
		const finder = await finders.ensure(roots.activeCwd);
		if (signal.aborted) return [];
		const result = finder.mixedSearch(query, { pageSize: MENTION_MAX_RESULTS });
		if (!result.ok) return [];
		return result.value.items.slice(0, MENTION_MAX_RESULTS).map((mixed: MixedItem) =>
			mixed.type === "directory"
				? {
						value: buildAtCompletionValue(mixed.item.relativePath),
						label: mixed.item.dirName,
						description: normalizeSlashes(mixed.item.relativePath),
					}
				: {
						value: buildAtCompletionValue(mixed.item.relativePath),
						label: mixed.item.fileName,
						description: normalizeSlashes(mixed.item.relativePath),
					},
		);
	}

	function registerAutocompleteProvider(ctx: {
		ui: {
			addAutocompleteProvider: (
				factory: (current: AutocompleteProvider) => AutocompleteProvider,
			) => void;
		};
	}) {
		ctx.ui.addAutocompleteProvider((current) => {
			const mentions = createFffMentionProvider(getMentionItems);
			return {
				async getSuggestions(lines, cursorLine, cursorCol, options) {
					if (currentMode !== "tools-only") {
						try {
							const result = await mentions.getSuggestions(lines, cursorLine, cursorCol, options);
							if (result) return result;
						} catch {
							// Delegate when the local index is unavailable.
						}
					}
					return current.getSuggestions(lines, cursorLine, cursorCol, options);
				},
				applyCompletion: (...args) => current.applyCompletion(...args),
				shouldTriggerFileCompletion: (...args) =>
					current.shouldTriggerFileCompletion?.(...args) ?? true,
			};
		});
	}

	pi.registerFlag("fff-mode", {
		description: "FFF mode: tools-and-ui | tools-only | override",
		type: "string",
	});
	pi.registerFlag("fff-frecency-db", { description: "Path to the frecency database", type: "string" });
	pi.registerFlag("fff-history-db", { description: "Path to the query history database", type: "string" });
	pi.registerFlag("fff-enable-root-scan", { description: "Allow indexing filesystem root", type: "boolean" });

	pi.on("session_start", async (_event, ctx) => {
		try {
			roots.refresh(ctx.cwd);
			cursors.clear("root refresh");
			const entries = ctx.sessionManager?.getEntries();
			currentMode = restoreFffMode(entries, currentMode);
			registerAutocompleteProvider(ctx);
			await finders.ensure(roots.activeCwd);
		} catch (error) {
			ctx.ui.notify(
				`FFF+ init failed: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
		}
	});
	pi.on("session_shutdown", async () => finders.destroy());

	const renderTextResult = (
		result: { content?: { type: string; text?: string }[] },
		options: { expanded?: boolean },
		theme: any,
		context: any,
		maxLines: number,
	) => {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		const output = result.content?.find((item) => item.type === "text")?.text?.trim() ?? "";
		if (!output) {
			text.setText(theme.fg("muted", "No output"));
			return text;
		}
		const lines = output.split("\n");
		const shown = lines.slice(0, options.expanded ? lines.length : maxLines);
		let content = `\n${shown.map((line) => theme.fg("toolOutput", line)).join("\n")}`;
		if (lines.length > shown.length) content += theme.fg("muted", `\n... (${lines.length - shown.length} more lines)`);
		text.setText(content);
		return text;
	};

	pi.registerTool({
		name: toolNames.grep,
		label: toolNames.grep,
		description: `Grep file contents with FFF+. Default global limit ${DEFAULT_GREP_LIMIT}; bounded context and output.`,
		promptSnippet: "Grep contents",
		promptGuidelines: [
			"Prefer bare identifiers as patterns. Literal queries are most efficient.",
			"Absolute paths are allowed only inside configured roots.",
			"Repeat all query parameters when continuing with a cursor.",
		],
		parameters: grepSchema,
		execute: (_id, params, signal) => executeGrep(params, signal, toolDeps),
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(theme.fg("toolTitle", theme.bold(toolNames.grep)) + " " + theme.fg("accent", `/${args?.pattern ?? ""}/`) + theme.fg("toolOutput", ` in ${args?.path ?? "."}`));
			return text;
		},
		renderResult: (result, options, theme, context) => renderTextResult(result, options, theme, context, 15),
	});

	pi.registerTool({
		name: toolNames.find,
		label: toolNames.find,
		description: `FFF+ fuzzy path search. Default limit ${DEFAULT_FIND_LIMIT}; bounded output.`,
		promptSnippet: "Find files by path or glob",
		promptGuidelines: [
			"Use for paths, not content. Use grep for content.",
			"Absolute paths are allowed only inside configured roots.",
			"Repeat all query parameters when continuing with a cursor.",
		],
		parameters: findSchema,
		execute: (_id, params, signal) => executeFind(params, signal, toolDeps),
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(theme.fg("toolTitle", theme.bold(toolNames.find)) + " " + theme.fg("accent", args?.pattern ?? "") + theme.fg("toolOutput", ` in ${args?.path ?? "."}`));
			return text;
		},
		renderResult: (result, options, theme, context) => renderTextResult(result, options, theme, context, 20),
	});

	pi.registerCommand("fff-mode", {
		description: "Show or set FFF mode: /fff-mode [tools-and-ui | tools-only | override]",
		handler: async (args, ctx) => {
			const requested = (args || "").trim();
			if (!requested) return ctx.ui.notify(`Current mode: '${currentMode}'`, "info");
			if (!VALID_MODES.includes(requested as FffMode)) {
				return ctx.ui.notify(`Usage: /fff-mode [${VALID_MODES.join(" | ")}]`, "warning");
			}
			const previous = currentMode;
			currentMode = requested as FffMode;
			cursors.clear("mode change");
			pi.appendEntry("fff-mode", { mode: currentMode });
			const reload = (previous === "override") !== (currentMode === "override") ? " (tool name change requires /reload)" : "";
			ctx.ui.notify(`Mode changed: '${previous}' → '${currentMode}'${reload}`, "info");
		},
	});

	pi.registerCommand("fff-health", {
		description: "Show FFF+ file finder health and configured roots",
		handler: async (_args, ctx) => {
			const lines = [
				`FFF+ mode: ${currentMode}`,
				`Active cwd: ${normalizeSlashes(roots.activeCwd)}`,
				"Configured roots:",
			];
			for (const root of roots.knownRoots) {
				const finder = finders.get(root);
				if (!finder) {
					lines.push(`- ${normalizeSlashes(root)}: not initialized`);
					continue;
				}
				const health = finder.healthCheck();
				lines.push(
					health.ok
						? `- ${normalizeSlashes(root)}: ${health.value.filePicker.indexedFiles ?? 0} files`
						: `- ${normalizeSlashes(root)}: health failed: ${health.error}`,
				);
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("fff-rescan", {
		description: "Trigger FFF+ to rescan initialized roots",
		handler: async (_args, ctx) => {
			const count = finders.rescan();
			ctx.ui.notify(`FFF+ rescan triggered for ${count} initialized root${count === 1 ? "" : "s"}`, "info");
		},
	});
}
