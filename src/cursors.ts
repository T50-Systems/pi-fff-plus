export type SearchKind = "grep" | "find";

export interface CursorBinding {
	kind: SearchKind;
	rootIdentity: string;
	rootGeneration: number;
	pattern: string;
	path: string;
	exclude: string[];
	caseSensitive: boolean;
	context: number;
	limit: number;
	mode: string;
}

export interface CursorRecord<T> {
	binding: CursorBinding;
	state: T;
}

function stableBinding(binding: CursorBinding): string {
	return JSON.stringify({
		...binding,
		exclude: [...binding.exclude].sort(),
	});
}

export class CursorStore {
	private readonly records = new Map<string, CursorRecord<unknown>>();
	private counter = 0;

	constructor(private readonly capacity = 200) {}

	store<T>(record: CursorRecord<T>): string {
		const id = `fff_c${++this.counter}`;
		this.records.set(id, record);
		if (this.records.size > this.capacity) {
			this.records.delete(this.records.keys().next().value!);
		}
		return id;
	}

	read<T>(id: string): CursorRecord<T> {
		const record = this.records.get(id) as CursorRecord<T> | undefined;
		if (!record) {
			throw new Error(
				`Unknown or evicted cursor "${id}". Restart the query without cursor.`,
			);
		}
		return record;
	}

	resume<T>(id: string, expected: CursorBinding): T {
		const record = this.read<T>(id);
		if (stableBinding(record.binding) !== stableBinding(expected)) {
			throw new Error(
				`Cursor "${id}" does not match this query or root generation. Restart the query without cursor using the original parameters.`,
			);
		}
		return record.state;
	}

	clear(reason = "root or finder state changed"): void {
		this.records.clear();
		void reason;
	}

	get size(): number {
		return this.records.size;
	}
}
