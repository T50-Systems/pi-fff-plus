import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts", "scripts/verify-workflow-actions.mjs"],
			thresholds: {
				statements: 85,
				branches: 70,
				functions: 85,
				lines: 90,
				// Keep the Pi lifecycle/UI entrypoint visible as its own regression budget.
				"src/index.ts": {
					statements: 85,
					branches: 65,
					functions: 85,
					lines: 90,
				},
			},
		},
	},
});
