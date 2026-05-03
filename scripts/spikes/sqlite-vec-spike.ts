import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const PACKAGE_NAME = "sqlite-vec";
const VECTOR_DIM = 384;
const VECTOR_COUNT = 100;
const K = 5;
const QUERY_REPEATS = 10;

type SpikeStep =
	| "dependency install"
	| "extension import"
	| "extension load"
	| "version check"
	| "virtual table create"
	| "insert"
	| "query";

type SqliteVecModule = {
	load?: (db: Database) => void;
	getLoadablePath?: () => string;
};

function fail(step: SpikeStep, error: unknown): never {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`❌ sqlite-vec spike FAILED at ${step}`);
	console.error(`error: ${message}`);
	console.error(
		"recommendation: fall back to HNSW WASM (hnswlib-node WASM build) per R1",
	);
	process.exit(2);
}

function hasSqliteVecDependency(): boolean {
	if (!existsSync("package.json")) {
		return false;
	}

	const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};

	return Boolean(
		packageJson.dependencies?.[PACKAGE_NAME] ??
			packageJson.devDependencies?.[PACKAGE_NAME],
	);
}

function ensureSqliteVecInstalled(): void {
	if (hasSqliteVecDependency()) {
		console.log("sqlite-vec dependency already present in package.json");
		return;
	}

	console.log(
		"sqlite-vec dependency missing from package.json; running `bun add sqlite-vec` now.",
	);

	const result = Bun.spawnSync(["bun", "add", PACKAGE_NAME], {
		stdout: "pipe",
		stderr: "pipe",
	});

	const stdout = result.stdout.toString().trim();
	const stderr = result.stderr.toString().trim();
	if (stdout.length > 0) {
		console.log(stdout);
	}
	if (stderr.length > 0) {
		console.error(stderr);
	}

	if (!result.success) {
		throw new Error(`bun add sqlite-vec failed with exit code ${result.exitCode}`);
	}
}

async function importSqliteVec(): Promise<SqliteVecModule> {
	const imported = (await import(PACKAGE_NAME)) as SqliteVecModule;
	return imported;
}

function loadSqliteVec(db: Database, sqliteVec: SqliteVecModule): void {
	try {
		if (typeof sqliteVec.load !== "function") {
			throw new Error("sqlite-vec load() export is unavailable");
		}
		sqliteVec.load(db);
		return;
	} catch (primaryError) {
		if (typeof sqliteVec.getLoadablePath !== "function") {
			throw primaryError;
		}

		try {
			db.loadExtension(sqliteVec.getLoadablePath());
		} catch (fallbackError) {
			const primaryMessage =
				primaryError instanceof Error ? primaryError.message : String(primaryError);
			const fallbackMessage =
				fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
			throw new Error(
				`sqliteVec.load() failed (${primaryMessage}); loadExtension() fallback failed (${fallbackMessage})`,
			);
		}
	}
}

function makeRandomVector(dim: number): Float32Array {
	const vector = new Float32Array(dim);
	const randomWords = new Uint32Array(vector.buffer);
	crypto.getRandomValues(randomWords);

	for (let index = 0; index < vector.length; index += 1) {
		vector[index] = randomWords[index] / 0xffffffff;
	}

	return vector;
}

function vectorToBuffer(vector: Float32Array): Buffer {
	return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

function percentile(sortedValues: number[], percentileValue: number): number {
	if (sortedValues.length === 0) {
		return 0;
	}

	const index = Math.ceil((percentileValue / 100) * sortedValues.length) - 1;
	return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, index))] ?? 0;
}

function runKnnQuery(db: Database, queryVector: Buffer): number {
	const start = performance.now();
	const rows = db
		.query("SELECT rowid, distance FROM chunks WHERE embedding MATCH ? AND k = ?")
		.all(queryVector, K);
	const elapsed = performance.now() - start;

	if (rows.length !== K) {
		throw new Error(`expected ${K} nearest neighbors, got ${rows.length}`);
	}

	return elapsed;
}

async function main(): Promise<void> {
	try {
		try {
			ensureSqliteVecInstalled();
		} catch (error) {
			fail("dependency install", error);
		}

		let sqliteVec: SqliteVecModule;
		try {
			sqliteVec = await importSqliteVec();
		} catch (error) {
			fail("extension import", error);
		}

		const db = new Database(":memory:");
		try {
			try {
				loadSqliteVec(db, sqliteVec);
			} catch (error) {
				fail("extension load", error);
			}

			let version: string;
			try {
				const row = db.query("SELECT vec_version() AS version").get() as {
					version: string;
				} | null;
				if (!row?.version) {
					throw new Error("vec_version() returned no version");
				}
				version = row.version;
			} catch (error) {
				fail("version check", error);
			}

			try {
				db.run(
					`CREATE VIRTUAL TABLE chunks USING vec0(embedding float[${VECTOR_DIM}])`,
				);
			} catch (error) {
				fail("virtual table create", error);
			}

			try {
				const insert = db.prepare("INSERT INTO chunks(embedding) VALUES (?)");
				const insertMany = db.transaction(() => {
					for (let index = 0; index < VECTOR_COUNT; index += 1) {
						insert.run(vectorToBuffer(makeRandomVector(VECTOR_DIM)));
					}
				});
				insertMany();
			} catch (error) {
				fail("insert", error);
			}

			let latencies: number[];
			try {
				latencies = Array.from({ length: QUERY_REPEATS }, () =>
					runKnnQuery(db, vectorToBuffer(makeRandomVector(VECTOR_DIM))),
				);
			} catch (error) {
				fail("query", error);
			}

			const sortedLatencies = [...latencies].sort((left, right) => left - right);
			const p50 = percentile(sortedLatencies, 50);
			const p95 = percentile(sortedLatencies, 95);

			console.log("✅ sqlite-vec spike OK");
			console.log(`vec_version=${version}`);
			console.log(`inserts: ${VECTOR_COUNT} vectors @ ${VECTOR_DIM} dim`);
			console.log(`knn p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms`);
			process.exit(0);
		} finally {
			db.close();
		}
	} catch (error) {
		fail("query", error);
	}
}

await main();
