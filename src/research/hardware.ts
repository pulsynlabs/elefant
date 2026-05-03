/**
 * Hardware profiler — detects RAM, CPU cores, GPU/NPU presence, and
 * recommends an embedding-provider tier.
 *
 * All shell-outs are wrapped in try/catch with timeouts; nothing throws
 * to the caller. The adapter pattern makes the whole module testable
 * without real OS calls.
 */



// ─── Types ──────────────────────────────────────────────────────────────────

export interface HardwareProfile {
  ramGB: number;
  cpuCores: number;
  hasGPU: boolean;
  hasNPU: boolean;
  platform: 'linux' | 'darwin' | 'win32' | 'other';
  gpuName: string | null;
}

export type RecommendedTier = 'bundled-large' | 'bundled-gpu' | 'bundled-cpu';

export interface HardwareProbeAdapters {
  totalmem: () => number;
  cpus: () => unknown[];
  platform: () => NodeJS.Platform;
  runCommand: (
    cmd: string,
    args: string[],
    opts?: { timeoutMs?: number },
  ) => Promise<{ stdout: string; stderr: string; code: number } | null>;
}

// ─── Platform normalisation ────────────────────────────────────────────────

function normalisePlatform(p: NodeJS.Platform): HardwareProfile['platform'] {
  if (p === 'linux' || p === 'darwin' || p === 'win32') return p;
  return 'other';
}

// ─── recommendTier ─────────────────────────────────────────────────────────

export function recommendTier(profile: HardwareProfile): RecommendedTier {
  if (profile.ramGB >= 16 && (profile.hasGPU || profile.hasNPU)) {
    return 'bundled-large';
  }
  if (profile.hasGPU) {
    return 'bundled-gpu';
  }
  return 'bundled-cpu';
}

// ─── GPU name extraction helpers ───────────────────────────────────────────

const INTEL_IGP_PATTERN = /\bIntel\b.+\b(UHD|HD\s*Graphics)\b/i;

/** Recursively walk a parsed JSON value and collect every leaf string. */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectStrings(v, out);
    }
  }
}

/**
 * Given a JSON blob from `system_profiler`, extract the first GPU name
 * that is *not* an Intel integrated part.  Returns `null` if nothing
 * matches.
 */
function extractMacGPUName(json: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  const candidates: string[] = [];
  collectStrings(parsed, candidates);

  // Prefer names that look like GPU models (contain common GPU vendors).
  const gpuLike = candidates.filter(
    (s) =>
      (/\b(AMD|NVIDIA|Radeon|GeForce|RTX|Quadro|Apple\s+M\d|Apple\s+M\d+\s+(Pro|Max|Ultra))\b/i.test(
        s,
      ) ||
        /\b(GPU|Graphics)\b/i.test(s)) &&
      s.length > 2,
  );

  for (const name of gpuLike) {
    if (!INTEL_IGP_PATTERN.test(name)) return name;
  }

  // Fallback: any string that doesn't look like Intel IGP
  for (const name of candidates) {
    if (name.length > 3 && !INTEL_IGP_PATTERN.test(name)) {
      // Avoid picking up JSON structural keys (case-insensitive) and generic labels.
      if (
        !/^sp(displays|pci)_/i.test(name) &&
        !/^_[a-z]/i.test(name) &&
        !/DataType$/i.test(name) &&
        !/^(Built-In|PCIe|Slot|Chipset\s+Model|Bus|Vendor|Type)\b/i.test(name)
      ) {
        return name;
      }
    }
  }

  return null;
}

/** Parse `system_profiler` JSON on macOS to detect GPU name and presence. */
async function detectDarwinGPU(
  runCommand: HardwareProbeAdapters['runCommand'],
): Promise<{ hasGPU: boolean; gpuName: string | null }> {
  const result = await runCommand(
    'system_profiler',
    ['SPDisplaysDataType', '-json'],
    { timeoutMs: 2000 },
  );
  if (!result || result.code !== 0) {
    return { hasGPU: false, gpuName: null };
  }

  const gpuName = extractMacGPUName(result.stdout);
  if (gpuName) {
    return { hasGPU: true, gpuName };
  }

  // If we have output but couldn't extract a name, check if the JSON
  // contains *any* non-Intel GPU reference (best-effort).
  const combined = result.stdout + result.stderr;
  if (
    /\b(GPU|Graphics|Display)\b/i.test(combined) &&
    !INTEL_IGP_PATTERN.test(combined)
  ) {
    // We know there's a GPU but couldn't get a clean name.
    return { hasGPU: true, gpuName: null };
  }

  return { hasGPU: false, gpuName: null };
}

/** Parse `nvidia-smi` output for a GPU name. */
function parseNvidiaSmiName(stdout: string): string | null {
  const line = stdout.split('\n')[0]?.trim();
  return line && line.length > 0 ? line : null;
}

/** Parse `lspci` output to find non-Intel discrete GPUs. */
function parseLspciGPUName(stdout: string): string | null {
  const lines = stdout.split('\n');
  const allGpuLines: string[] = [];
  const nonIntelLines: string[] = [];

  for (const line of lines) {
    if (!/VGA compatible controller|3D controller/i.test(line)) continue;
    allGpuLines.push(line);

    if (!INTEL_IGP_PATTERN.test(line)) {
      nonIntelLines.push(line);
    }
  }

  // If we have a non-Intel GPU, use it.
  const candidates =
    nonIntelLines.length > 0 ? nonIntelLines : allGpuLines;

  // Extract human-readable name from the lspci description.
  // Format: "01:00.0 VGA compatible controller [0300]: NVIDIA Corporation GA104 [GeForce RTX 3070] [10de:2484]"
  for (const line of candidates) {
    const bracketMatch = line.match(/\[([^\]]+)\]/g);
    if (bracketMatch) {
      // The last meaningful bracket before the PCI ID is usually the GPU name.
      // The PCI ID bracket looks like [10de:2484] — skip those.
      for (let i = bracketMatch.length - 1; i >= 0; i--) {
        const content = bracketMatch[i].slice(1, -1);
        if (/^[0-9a-f]{4}:[0-9a-f]{4}$/i.test(content)) continue;
        if (
          /^0[0-9a-f]{3}$/i.test(content) ||
          content === '0300' ||
          content === '0302'
        )
          continue;
        return content;
      }
    }
    // Fallback: grab the part after the last colon.
    const colonIdx = line.lastIndexOf(':');
    if (colonIdx !== -1) {
      const tail = line.slice(colonIdx + 1).trim();
      // Remove PCI ID bracket from tail
      const cleaned = tail.replace(/\s*\[[0-9a-f]{4}:[0-9a-f]{4}\]/i, '').trim();
      if (cleaned.length > 0) return cleaned;
    }
  }

  return null;
}

/** Detect GPU on Linux using nvidia-smi (fast path) then lspci (fallback). */
async function detectLinuxGPU(
  runCommand: HardwareProbeAdapters['runCommand'],
): Promise<{ hasGPU: boolean; gpuName: string | null }> {
  // Fast path: nvidia-smi
  const nvidiaResult = await runCommand(
    'nvidia-smi',
    ['--query-gpu=name', '--format=csv,noheader'],
    { timeoutMs: 2000 },
  );
  if (nvidiaResult && nvidiaResult.code === 0 && nvidiaResult.stdout) {
    const name = parseNvidiaSmiName(nvidiaResult.stdout);
    return { hasGPU: true, gpuName: name ?? 'NVIDIA GPU' };
  }

  // Fallback: lspci
  const lspciResult = await runCommand('lspci', ['-nnk'], {
    timeoutMs: 2000,
  });
  if (!lspciResult || lspciResult.code !== 0) {
    return { hasGPU: false, gpuName: null };
  }

  const gpuName = parseLspciGPUName(lspciResult.stdout);
  if (gpuName) {
    // Determine whether this is a non-Intel GPU.
    const hasNonIntel = lspciResult.stdout
      .split('\n')
      .some(
        (line) =>
          /VGA compatible controller|3D controller/i.test(line) &&
          !INTEL_IGP_PATTERN.test(line),
      );
    return { hasGPU: hasNonIntel, gpuName: hasNonIntel ? gpuName : null };
  }

  return { hasGPU: false, gpuName: null };
}

/** Detect GPU on Windows using wmic. */
async function detectWin32GPU(
  runCommand: HardwareProbeAdapters['runCommand'],
): Promise<{ hasGPU: boolean; gpuName: string | null }> {
  const result = await runCommand(
    'wmic',
    ['path', 'win32_VideoController', 'get', 'name'],
    { timeoutMs: 2000 },
  );
  if (!result || result.code !== 0) {
    return { hasGPU: false, gpuName: null };
  }

  const lines = result.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^Name\b/i.test(l));

  // Find first non-Intel GPU, or fall back to the first GPU listed.
  const nonIntel = lines.filter((l) => !INTEL_IGP_PATTERN.test(l));
  const gpuName = nonIntel.length > 0 ? nonIntel[0] : lines[0] ?? null;

  if (!gpuName) return { hasGPU: false, gpuName: null };

  return {
    hasGPU: nonIntel.length > 0,
    gpuName,
  };
}

// ─── NPU detection ─────────────────────────────────────────────────────────

async function detectNPU(
  platform: HardwareProfile['platform'],
  runCommand: HardwareProbeAdapters['runCommand'],
): Promise<boolean> {
  if (platform !== 'darwin') return false;

  // Apple Silicon detection: `uname -m` returns `arm64` on Apple Silicon Macs
  const result = await runCommand('uname', ['-m'], { timeoutMs: 2000 });
  if (result && result.code === 0 && result.stdout.includes('arm64')) {
    return true;
  }
  return false;
}

// ─── Core profiler (injectable) ────────────────────────────────────────────

export async function profileHardwareWith(
  adapters: HardwareProbeAdapters,
): Promise<HardwareProfile> {
  const platform = normalisePlatform(adapters.platform());

  const totalBytes = adapters.totalmem();
  const ramGB = Math.round((totalBytes / (1024 * 1024 * 1024)) * 10) / 10;

  const cpus = adapters.cpus();
  const cpuCores = Array.isArray(cpus) ? cpus.length : 0;

  // GPU detection — platform-specific, every shell-out wrapped in try/catch.
  let hasGPU = false;
  let gpuName: string | null = null;

  try {
    if (platform === 'darwin') {
      ({ hasGPU, gpuName } = await detectDarwinGPU(adapters.runCommand));
    } else if (platform === 'linux') {
      ({ hasGPU, gpuName } = await detectLinuxGPU(adapters.runCommand));
    } else if (platform === 'win32') {
      ({ hasGPU, gpuName } = await detectWin32GPU(adapters.runCommand));
    }
    // else: 'other' — leave all at defaults
  } catch {
    // Every GPU probe is best-effort; a crash should never escape.
  }

  // NPU detection
  let hasNPU = false;
  try {
    hasNPU = await detectNPU(platform, adapters.runCommand);
  } catch {
    // Best-effort.
  }

  return { ramGB, cpuCores, hasGPU, hasNPU, platform, gpuName };
}

// ─── Public (real OS) API ──────────────────────────────────────────────────

import { totalmem, cpus, platform as osPlatform } from 'node:os';

async function realRunCommand(
  cmd: string,
  args: string[],
  opts?: { timeoutMs?: number },
): Promise<{ stdout: string; stderr: string; code: number } | null> {
  const timeoutMs = opts?.timeoutMs ?? 2000;

  try {
    const proc = Bun.spawn([cmd, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      proc.kill();
    }, timeoutMs);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;

    clearTimeout(timer);

    if (killed) return null;
    return { stdout: stdout.trim(), stderr: stderr.trim(), code };
  } catch {
    return null;
  }
}

export async function profileHardware(): Promise<HardwareProfile> {
  return profileHardwareWith({
    totalmem,
    cpus,
    platform: osPlatform,
    runCommand: realRunCommand,
  });
}
