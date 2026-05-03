import { existsSync, readFileSync } from "node:fs";
import { pipeline, env } from "@xenova/transformers";

type FeatureExtractionPipeline = (
	input: string,
	options: { pooling: "mean"; normalize: true },
) => Promise<EmbeddingOutput>;

type EmbeddingOutput = {
	data?: Float32Array | number[];
	dims?: number[];
	size?: number;
	length?: number;
	tolist?: () => unknown;
};

type LatencyStats = {
	average: number;
	p50: number;
	p90: number;
	p95: number;
	p99: number;
};

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const EXPECTED_DIM = 384;
const SENTENCE_COUNT = 50;
const PACKAGE_NAME = "@xenova/transformers";

env.allowRemoteModels = true;
env.allowLocalModels = true;

function fail(step: string, error: unknown): never {
	console.error(`❌ transformers spike FAILED at ${step}`);
	if (error instanceof Error) {
		console.error(error.stack ?? error.message);
	} else {
		console.error(String(error));
	}
	process.exit(2);
}

function assertDependencyInstalled(): void {
	try {
		const packageJsonPath = "package.json";
		if (!existsSync(packageJsonPath)) {
			fail("dependency-check", new Error("package.json not found"));
		}

		const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};

		const hasDependency =
			packageJson.dependencies?.[PACKAGE_NAME] !== undefined ||
			packageJson.devDependencies?.[PACKAGE_NAME] !== undefined;

		if (!hasDependency) {
			fail(
				"dependency-check",
				new Error(
					`${PACKAGE_NAME} is not listed in package.json. Install with: bun add ${PACKAGE_NAME}`,
				),
			);
		}
	} catch (error) {
		fail("dependency-check", error);
	}
}

function toFloat32Array(output: EmbeddingOutput): Float32Array {
	if (output.data instanceof Float32Array) {
		return output.data;
	}

	if (Array.isArray(output.data)) {
		return Float32Array.from(output.data);
	}

	const listed = output.tolist?.();
	if (Array.isArray(listed)) {
		const flattened = listed.flat(Number.POSITIVE_INFINITY);
		if (flattened.every((value): value is number => typeof value === "number")) {
			return Float32Array.from(flattened);
		}
	}

	throw new Error("Unable to extract embedding vector from transformers output");
}

function percentile(sortedValues: number[], percentileValue: number): number {
	if (sortedValues.length === 0) {
		throw new Error("Cannot compute percentile for empty latency set");
	}

	const index = Math.ceil((percentileValue / 100) * sortedValues.length) - 1;
	return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, index))] ?? 0;
}

function computeStats(latencies: number[]): LatencyStats {
	const sorted = [...latencies].sort((left, right) => left - right);
	const total = latencies.reduce((sum, value) => sum + value, 0);

	return {
		average: total / latencies.length,
		p50: percentile(sorted, 50),
		p90: percentile(sorted, 90),
		p95: percentile(sorted, 95),
		p99: percentile(sorted, 99),
	};
}

function formatMs(value: number): string {
	return value.toFixed(2);
}

async function main(): Promise<void> {
	assertDependencyInstalled();

	let extractor: FeatureExtractionPipeline;
	try {
		extractor = (await pipeline("feature-extraction", MODEL_ID)) as FeatureExtractionPipeline;
	} catch (error) {
		fail("pipeline-load", error);
	}

	const sentences = Array.from(
		{ length: SENTENCE_COUNT },
		(_, index) => `Lorem ipsum dolor sit amet, consectetur ${index}`,
	);

	const latencies: number[] = [];
	let embeddingDim = 0;

	for (const sentence of sentences) {
		try {
			const startedAt = performance.now();
			const output = await extractor(sentence, { pooling: "mean", normalize: true });
			const elapsedMs = performance.now() - startedAt;
			const vector = toFloat32Array(output);

			if (vector.length !== EXPECTED_DIM) {
				throw new Error(`Expected ${EXPECTED_DIM}-dim embedding, received ${vector.length}`);
			}

			embeddingDim = vector.length;
			latencies.push(elapsedMs);
		} catch (error) {
			fail("embedding", error);
		}
	}

	const stats = computeStats(latencies);

	console.log("✅ transformers spike OK");
	console.log(`package=${PACKAGE_NAME}`);
	console.log(`model=${MODEL_ID}`);
	console.log("backend=onnx-cpu");
	console.log(`sentences=${SENTENCE_COUNT}`);
	console.log(`embedding_dim=${embeddingDim}`);
	console.log("latency_ms");
	console.table({
		average: formatMs(stats.average),
		p50: formatMs(stats.p50),
		p90: formatMs(stats.p90),
		p95: formatMs(stats.p95),
		p99: formatMs(stats.p99),
	});
}

await main();
