import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COMMIT_SHA = /^[0-9a-f]{40}$/;
const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const ACTION_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;

function relativePath(root, file) {
	return path.relative(root, file).split(path.sep).join("/");
}

function listWorkflowFiles(directory) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const resolved = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...listWorkflowFiles(resolved));
		else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) files.push(resolved);
	}
	return files.sort();
}

function validationError(errors) {
	return new Error(`Workflow action validation failed:\n- ${errors.join("\n- ")}`);
}

function inspectPolicy(policy, policyFile) {
	const errors = [];
	if (policy?.schemaVersion !== 1 || !Array.isArray(policy?.pins)) {
		throw validationError([`${policyFile}: expected schemaVersion 1 and a pins array`]);
	}

	const keys = new Set();
	for (const [index, pin] of policy.pins.entries()) {
		const location = `${policyFile}: pins[${index}]`;
		if (!ACTION_NAME.test(pin.action ?? "")) errors.push(`${location} has an invalid action name`);
		if (!COMMIT_SHA.test(pin.sha ?? "")) errors.push(`${location} must document a lowercase 40-character commit SHA`);
		if (!RELEASE_TAG.test(pin.releaseTag ?? "")) errors.push(`${location} must document a full release tag such as v5.0.1`);
		if (!pin.publisher?.trim()) errors.push(`${location} must document the publisher`);
		if (pin.officialRepository !== `https://github.com/${pin.action}`) errors.push(`${location} must link the official GitHub repository`);
		if (pin.releaseEvidence !== `${pin.officialRepository}/releases/tag/${pin.releaseTag}`) errors.push(`${location} has invalid release/tag evidence`);
		if (pin.commitEvidence !== `${pin.officialRepository}/commit/${pin.sha}`) errors.push(`${location} has invalid commit evidence`);
		if (pin.reviewStatus !== "reviewed") errors.push(`${location} is not marked reviewed`);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(pin.reviewedOn ?? "")) errors.push(`${location} must record its review date`);
		if (!pin.references || typeof pin.references !== "object" || Array.isArray(pin.references)) {
			errors.push(`${location} must inventory workflow reference counts`);
		} else {
			for (const [workflow, count] of Object.entries(pin.references)) {
				if (!/^\.github\/workflows\/.+\.ya?ml$/i.test(workflow) || !Number.isInteger(count) || count < 1) {
					errors.push(`${location} has an invalid reference inventory entry ${workflow}: ${String(count)}`);
				}
			}
		}

		const key = `${pin.action}@${pin.sha}#${pin.releaseTag}`;
		if (keys.has(key)) errors.push(`${location} duplicates ${key}`);
		keys.add(key);
	}
	if (errors.length > 0) throw validationError(errors);
	return policy.pins;
}

export function loadActionPolicy(policyFile) {
	let policy;
	try {
		policy = JSON.parse(readFileSync(policyFile, "utf8"));
	} catch (error) {
		throw validationError([`${policyFile}: ${error instanceof Error ? error.message : String(error)}`]);
	}
	return inspectPolicy(policy, policyFile);
}

function inspectWorkflowSource(source, file, pins) {
	const errors = [];
	const references = [];
	const pinsByAction = new Map();
	for (const pin of pins) {
		const existing = pinsByAction.get(pin.action) ?? [];
		existing.push(pin);
		pinsByAction.set(pin.action, existing);
	}

	for (const [index, line] of source.split(/\r?\n/).entries()) {
		if (line.trimStart().startsWith("#") || !/\buses\s*:/.test(line)) continue;
		const location = `${file}:${index + 1}`;
		const match = line.match(/^\s*(?:-\s*)?uses\s*:\s*(?:(["'])([^"']+)\1|([^\s#]+))(?:\s+#\s*(\S+))?\s*$/);
		if (!match) {
			errors.push(`${location} has an unsupported uses declaration; use one literal reference and a trailing release tag comment`);
			continue;
		}

		const value = match[2] ?? match[3];
		const releaseTag = match[4];
		if (value.startsWith("./")) continue;

		const separator = value.lastIndexOf("@");
		const action = separator > 0 ? value.slice(0, separator) : "";
		const sha = separator > 0 ? value.slice(separator + 1) : "";
		if (!ACTION_NAME.test(action)) {
			errors.push(`${location} must use an owner/repository action from the reviewed inventory; found ${value}`);
			continue;
		}
		if (!COMMIT_SHA.test(sha)) {
			errors.push(`${location} must pin ${action} to a lowercase 40-character commit SHA; found ${sha || "no ref"}`);
			continue;
		}
		if (!RELEASE_TAG.test(releaseTag ?? "")) {
			errors.push(`${location} must end with a full release tag comment such as # v5.0.1`);
			continue;
		}

		const reviewed = (pinsByAction.get(action) ?? []).find((pin) => pin.sha === sha && pin.releaseTag === releaseTag);
		if (!reviewed) {
			const reason = pinsByAction.has(action) ? "does not match the reviewed SHA and release tag" : "is not documented in .github/actions-pins.json";
			errors.push(`${location} ${action}@${sha} # ${releaseTag} ${reason}`);
			continue;
		}
		references.push({ action, sha, releaseTag, file });
	}
	return { errors, references };
}

export function validateWorkflowSource(source, file, pins) {
	const result = inspectWorkflowSource(source, file, pins);
	if (result.errors.length > 0) throw validationError(result.errors);
	return result.references;
}

function verifyDependabot(root) {
	const file = path.join(root, ".github", "dependabot.yml");
	const lines = readFileSync(file, "utf8").split(/\r?\n/);
	const start = lines.findIndex((line) => /^\s*-\s*package-ecosystem\s*:\s*["']?github-actions["']?\s*$/.test(line));
	if (start < 0) return [`${relativePath(root, file)} must retain a github-actions update entry`];
	const indent = lines[start].match(/^\s*/)?.[0].length ?? 0;
	let end = lines.length;
	for (let index = start + 1; index < lines.length; index += 1) {
		if ((lines[index].match(/^\s*/)?.[0].length ?? 0) === indent && /^\s*-\s*package-ecosystem\s*:/.test(lines[index])) {
			end = index;
			break;
		}
	}
	const block = lines.slice(start, end).join("\n");
	const errors = [];
	if (!/^\s*directory\s*:\s*["']?\/["']?\s*$/m.test(block)) errors.push(`${relativePath(root, file)} github-actions updates must cover the repository root`);
	if (!/^\s*interval\s*:\s*["']?(?:daily|weekly|monthly)["']?\s*$/m.test(block)) errors.push(`${relativePath(root, file)} github-actions updates must have a supported schedule`);
	return errors;
}

export function validateRepository(root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))) {
	const policyFile = path.join(root, ".github", "actions-pins.json");
	const pins = loadActionPolicy(policyFile);
	const workflowDirectory = path.join(root, ".github", "workflows");
	const workflowFiles = listWorkflowFiles(workflowDirectory);
	const errors = [];
	const actual = new Map();

	if (workflowFiles.length === 0) errors.push(".github/workflows contains no YAML workflows");
	for (const workflowFile of workflowFiles) {
		const file = relativePath(root, workflowFile);
		const result = inspectWorkflowSource(readFileSync(workflowFile, "utf8"), file, pins);
		errors.push(...result.errors);
		for (const reference of result.references) {
			const key = `${reference.action}@${reference.sha}#${reference.releaseTag}`;
			const byFile = actual.get(key) ?? new Map();
			byFile.set(file, (byFile.get(file) ?? 0) + 1);
			actual.set(key, byFile);
		}
	}

	for (const pin of pins) {
		const key = `${pin.action}@${pin.sha}#${pin.releaseTag}`;
		const found = actual.get(key) ?? new Map();
		const files = new Set([...Object.keys(pin.references), ...found.keys()]);
		for (const file of files) {
			const expectedCount = pin.references[file] ?? 0;
			const actualCount = found.get(file) ?? 0;
			if (expectedCount !== actualCount) errors.push(`.github/actions-pins.json inventories ${key} ${expectedCount} time(s) in ${file}, found ${actualCount}`);
		}
	}
	errors.push(...verifyDependabot(root));
	if (errors.length > 0) throw validationError(errors);

	const referenceCount = [...actual.values()].reduce((sum, byFile) => sum + [...byFile.values()].reduce((subtotal, count) => subtotal + count, 0), 0);
	console.log(`Verified ${referenceCount} external action reference(s) across ${workflowFiles.length} workflow YAML file(s); Dependabot github-actions updates are configured.`);
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedFile === fileURLToPath(import.meta.url)) {
	try {
		validateRepository();
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
