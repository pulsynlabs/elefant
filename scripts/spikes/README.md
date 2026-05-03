## transformers.js spike (W1.3)
- Status: PASS
- Package: `@xenova/transformers@2.17.2`
- Model: Xenova/all-MiniLM-L6-v2
- Backend: onnx-cpu
- embedding_dim: 384
- Latency: p50=2.85ms, p95=3.42ms, p99=9.05ms
- Decision: use bundled-cpu

## sqlite-vec spike (W1.2)
- Status: PASS on Linux
- Date: 2026-05-02
- vec_version: v0.1.9
- Latency: p50=0.136ms / p95=0.986ms
- Decision: use sqlite-vec
- Verification command: `bun run scripts/spikes/sqlite-vec-spike.ts; echo "exit=$?"`
- Exit code: 0
- Output:
  ```text
  sqlite-vec dependency already present in package.json
  ✅ sqlite-vec spike OK
  vec_version=v0.1.9
  inserts: 100 vectors @ 384 dim
  knn p50=0.136ms p95=0.986ms
  exit=0
  ```
