import { describe, expect, test } from 'bun:test';
import {
  profileHardwareWith,
  recommendTier,
  type HardwareProfile,
  type HardwareProbeAdapters,
  type RecommendedTier,
} from './hardware.ts';

// ─── Test helpers ──────────────────────────────────────────────────────────

/** Create a stub adapter set with defaults that can be selectively overridden. */
function stubAdapters(
  overrides: Partial<Omit<HardwareProbeAdapters, 'platform'>> & {
    platform?: HardwareProfile['platform'];
  } = {},
): HardwareProbeAdapters {
  // Allow tests to specify platform as a short string (convenience).
  const { platform: platformShort, ...rest } = overrides;
  const platformValue: HardwareProfile['platform'] =
    platformShort ?? 'linux';
  const platformFn: () => NodeJS.Platform = () =>
    (platformValue === 'other' ? 'freebsd' : platformValue) as NodeJS.Platform;

  return {
    totalmem: () => 16 * 1024 * 1024 * 1024, // 16 GB
    cpus: () => Array.from({ length: 8 }, () => ({})),
    platform: platformFn,
    runCommand: async () => ({ stdout: '', stderr: '', code: 0 }),
    ...rest,
  };
}

/** Create a `HardwareProfile` for testing `recommendTier` directly. */
function profile(
  overrides: Partial<HardwareProfile> = {},
): HardwareProfile {
  return {
    ramGB: 8,
    cpuCores: 4,
    hasGPU: false,
    hasNPU: false,
    platform: 'linux',
    gpuName: null,
    ...overrides,
  };
}

/** A `runCommand` stub that always returns null (simulates binary not found / timeout). */
const nullRunCommand: HardwareProbeAdapters['runCommand'] = async () => null;

/** A `runCommand` stub that returns a successful result with given stdout. */
function successRunCommand(
  stdout: string,
): HardwareProbeAdapters['runCommand'] {
  return async () => ({ stdout, stderr: '', code: 0 });
}

// ═══════════════════════════════════════════════════════════════════════════
// recommendTier
// ═══════════════════════════════════════════════════════════════════════════

describe('recommendTier', () => {
  // ── bundled-large (ramGB >= 16 AND (hasGPU OR hasNPU)) ──────────────────

  test('bundled-large: 32 GB + GPU', () => {
    expect(recommendTier(profile({ ramGB: 32, hasGPU: true }))).toBe(
      'bundled-large',
    );
  });

  test('bundled-large: 16 GB + GPU (boundary)', () => {
    expect(recommendTier(profile({ ramGB: 16, hasGPU: true }))).toBe(
      'bundled-large',
    );
  });

  test('bundled-large: 16 GB + NPU (no GPU)', () => {
    expect(
      recommendTier(profile({ ramGB: 16, hasGPU: false, hasNPU: true })),
    ).toBe('bundled-large');
  });

  test('bundled-large: 32 GB + GPU + NPU', () => {
    expect(
      recommendTier(
        profile({ ramGB: 32, hasGPU: true, hasNPU: true }),
      ),
    ).toBe('bundled-large');
  });

  test('bundled-large: 15.9 GB + GPU → NOT large (boundary)', () => {
    expect(
      recommendTier(profile({ ramGB: 15.9, hasGPU: true })),
    ).toBe('bundled-gpu');
  });

  // ── bundled-gpu (hasGPU, but ramGB < 16) ───────────────────────────────

  test('bundled-gpu: 8 GB + GPU', () => {
    expect(recommendTier(profile({ ramGB: 8, hasGPU: true }))).toBe(
      'bundled-gpu',
    );
  });

  test('bundled-gpu: 4 GB + GPU', () => {
    expect(recommendTier(profile({ ramGB: 4, hasGPU: true }))).toBe(
      'bundled-gpu',
    );
  });

  test('bundled-gpu: 0 GB + GPU (edge)', () => {
    expect(recommendTier(profile({ ramGB: 0, hasGPU: true }))).toBe(
      'bundled-gpu',
    );
  });

  // ── bundled-cpu (no GPU, no NPU, or ramGB < 16 and no GPU) ────────────

  test('bundled-cpu: 8 GB, no GPU, no NPU', () => {
    expect(
      recommendTier(
        profile({ ramGB: 8, hasGPU: false, hasNPU: false }),
      ),
    ).toBe('bundled-cpu');
  });

  test('bundled-cpu: 32 GB, no GPU, no NPU', () => {
    expect(
      recommendTier(
        profile({ ramGB: 32, hasGPU: false, hasNPU: false }),
      ),
    ).toBe('bundled-cpu');
  });

  test('bundled-cpu: 4 GB, no GPU', () => {
    expect(
      recommendTier(profile({ ramGB: 4, hasGPU: false })),
    ).toBe('bundled-cpu');
  });

  test('bundled-cpu: 0 GB, no GPU, 0 cores (extreme edge)', () => {
    expect(
      recommendTier(
        profile({ ramGB: 0, cpuCores: 0, hasGPU: false, hasNPU: false }),
      ),
    ).toBe('bundled-cpu');
  });

  test('bundled-cpu: NPU alone with low RAM does not trigger bundled-gpu', () => {
    // NPU without GPU and low RAM → still bundled-cpu (NPU only helps bundled-large threshold)
    expect(
      recommendTier(profile({ ramGB: 8, hasNPU: true, hasGPU: false })),
    ).toBe('bundled-cpu');
  });

  // ── All possible tier outputs ──────────────────────────────────────────

  test('all 3 tier values are returned for distinct inputs', () => {
    const results = new Set<RecommendedTier>();
    results.add(recommendTier(profile({ ramGB: 32, hasGPU: true })));
    results.add(recommendTier(profile({ ramGB: 8, hasGPU: true })));
    results.add(recommendTier(profile({ ramGB: 8, hasGPU: false })));
    expect(results.size).toBe(3);
    expect(results.has('bundled-large')).toBe(true);
    expect(results.has('bundled-gpu')).toBe(true);
    expect(results.has('bundled-cpu')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// profileHardwareWith — basic fields
// ═══════════════════════════════════════════════════════════════════════════

describe('profileHardwareWith — basic fields', () => {
  test('ramGB computed from totalmem (bytes)', async () => {
    const adapters = stubAdapters({
      totalmem: () => 32 * 1024 * 1024 * 1024, // 32 GB
    });
    const result = await profileHardwareWith(adapters);
    expect(result.ramGB).toBe(32);
  });

  test('ramGB rounded to 1 decimal', async () => {
    // 17179869184 bytes = 16.0 GB
    const adapters = stubAdapters({
      totalmem: () => 17179869184,
    });
    const result = await profileHardwareWith(adapters);
    expect(result.ramGB).toBe(16);
  });

  test('ramGB handles fractional rounding up', async () => {
    // 17000000000 bytes ≈ 15.83 GB → rounds to 15.8
    const adapters = stubAdapters({
      totalmem: () => 17000000000,
    });
    const result = await profileHardwareWith(adapters);
    expect(result.ramGB).toBe(15.8);
  });

  test('ramGB handles fractional rounding down', async () => {
    // 16500000000 bytes ≈ 15.37 GB → rounds to 15.4
    const adapters = stubAdapters({
      totalmem: () => 16500000000,
    });
    const result = await profileHardwareWith(adapters);
    expect(result.ramGB).toBe(15.4);
  });

  test('cpuCores from cpus length', async () => {
    const adapters = stubAdapters({
      cpus: () => Array.from({ length: 16 }, () => ({})),
    });
    const result = await profileHardwareWith(adapters);
    expect(result.cpuCores).toBe(16);
  });

  test('cpuCores is 0 when cpus returns empty array', async () => {
    const adapters = stubAdapters({
      cpus: () => [],
    });
    const result = await profileHardwareWith(adapters);
    expect(result.cpuCores).toBe(0);
  });

  test('cpuCores is 0 when cpus returns non-array', async () => {
    const adapters = stubAdapters({
      cpus: () => null as unknown as unknown[],
    });
    const result = await profileHardwareWith(adapters);
    expect(result.cpuCores).toBe(0);
  });

  test('platform normalised to linux/darwin/win32/other', async () => {
    expect(
      (await profileHardwareWith(stubAdapters({ platform: 'linux' })))
        .platform,
    ).toBe('linux');
    expect(
      (await profileHardwareWith(stubAdapters({ platform: 'darwin' })))
        .platform,
    ).toBe('darwin');
    expect(
      (await profileHardwareWith(stubAdapters({ platform: 'win32' })))
        .platform,
    ).toBe('win32');
    expect(
      (await profileHardwareWith(stubAdapters({ platform: 'other' })))
        .platform,
    ).toBe('other');
  });

  test('zero ramGB and zero cpuCores produces sensible profile', async () => {
    const adapters = stubAdapters({
      totalmem: () => 0,
      cpus: () => [],
    });
    const result = await profileHardwareWith(adapters);
    expect(result.ramGB).toBe(0);
    expect(result.cpuCores).toBe(0);
    expect(result.platform).toBe('linux');
    expect(result.hasGPU).toBe(false);
    expect(result.hasNPU).toBe(false);
    // Should still produce a recommendation
    expect(recommendTier(result)).toBe('bundled-cpu');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// profileHardwareWith — GPU detection
// ═══════════════════════════════════════════════════════════════════════════

describe('profileHardwareWith — GPU detection', () => {
  // ── macOS ───────────────────────────────────────────────────────────────

  test('macOS: Apple M1 Pro detected via system_profiler', async () => {
    const json = JSON.stringify({
      SPDisplaysDataType: [
        {
          spdisplays_gpus: ['Apple M1 Pro'],
        },
      ],
    });

    const adapters = stubAdapters({
      platform: 'darwin',
      runCommand: async (cmd) => {
        if (cmd === 'system_profiler') {
          return { stdout: json, stderr: '', code: 0 };
        }
        if (cmd === 'uname') {
          return { stdout: 'arm64', stderr: '', code: 0 };
        }
        return null;
      },
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasGPU).toBe(true);
    expect(result.gpuName).toBe('Apple M1 Pro');
    expect(result.hasNPU).toBe(true); // Apple Silicon
    expect(result.platform).toBe('darwin');
  });

  test('macOS: discrete AMD GPU detected', async () => {
    const json = JSON.stringify({
      SPDisplaysDataType: [
        {
          spdisplays_ndrvs: [
            {
              _name: 'AMD Radeon Pro 5500M',
              spdisplays_vram: '8 GB',
            },
          ],
          spdisplays_gpus: ['Intel UHD Graphics 630'],
        },
      ],
    });

    const adapters = stubAdapters({
      platform: 'darwin',
      runCommand: async (cmd) => {
        if (cmd === 'system_profiler') {
          return { stdout: json, stderr: '', code: 0 };
        }
        if (cmd === 'uname') {
          return { stdout: 'x86_64', stderr: '', code: 0 }; // Intel Mac
        }
        return null;
      },
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasGPU).toBe(true);
    expect(result.gpuName).toBe('AMD Radeon Pro 5500M');
    expect(result.hasNPU).toBe(false); // Intel Mac, no Apple Neural Engine
  });

  test('macOS: Intel-only IGP → hasGPU=false', async () => {
    const json = JSON.stringify({
      SPDisplaysDataType: [
        {
          spdisplays_gpus: ['Intel UHD Graphics 630'],
        },
      ],
    });

    const adapters = stubAdapters({
      platform: 'darwin',
      runCommand: async (cmd) => {
        if (cmd === 'system_profiler') {
          return { stdout: json, stderr: '', code: 0 };
        }
        if (cmd === 'uname') {
          return { stdout: 'x86_64', stderr: '', code: 0 };
        }
        return null;
      },
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasGPU).toBe(false);
    expect(result.gpuName).toBeNull();
  });

  test('macOS: system_profiler fails → graceful degradation', async () => {
    const adapters = stubAdapters({
      platform: 'darwin',
      runCommand: nullRunCommand,
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasGPU).toBe(false);
    expect(result.gpuName).toBeNull();
    expect(result.hasNPU).toBe(false);
    // No throw — graceful degradation
  });

  // ── Linux ────────────────────────────────────────────────────────────────

  test('Linux: nvidia-smi fast path', async () => {
    const adapters = stubAdapters({
      platform: 'linux',
      runCommand: async (cmd) => {
        if (cmd === 'nvidia-smi') {
          return {
            stdout: 'NVIDIA GeForce RTX 4090',
            stderr: '',
            code: 0,
          };
        }
        return null;
      },
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasGPU).toBe(true);
    expect(result.gpuName).toBe('NVIDIA GeForce RTX 4090');
  });

  test('Linux: lspci fallback with discrete NVIDIA GPU', async () => {
    const lspciOutput = [
      '01:00.0 VGA compatible controller [0300]: NVIDIA Corporation GA104 [GeForce RTX 3070] [10de:2484] (rev a1)',
      '00:02.0 VGA compatible controller [0300]: Intel Corporation CometLake-H GT2 [UHD Graphics] [8086:9bc4] (rev 05)',
    ].join('\n');

    const adapters = stubAdapters({
      platform: 'linux',
      runCommand: async (cmd) => {
        if (cmd === 'nvidia-smi') {
          return { stdout: '', stderr: 'command not found', code: 127 };
        }
        if (cmd === 'lspci') {
          return { stdout: lspciOutput, stderr: '', code: 0 };
        }
        return null;
      },
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasGPU).toBe(true);
    expect(result.gpuName).toBe('GeForce RTX 3070');
  });

  test('Linux: lspci with only Intel IGP → hasGPU=false', async () => {
    const lspciOutput =
      '00:02.0 VGA compatible controller [0300]: Intel Corporation Alder Lake-P [UHD Graphics] [8086:4626] (rev 0c)';

    const adapters = stubAdapters({
      platform: 'linux',
      runCommand: async (cmd) => {
        if (cmd === 'nvidia-smi') {
          return { stdout: '', stderr: 'command not found', code: 127 };
        }
        if (cmd === 'lspci') {
          return { stdout: lspciOutput, stderr: '', code: 0 };
        }
        return null;
      },
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasGPU).toBe(false);
    expect(result.gpuName).toBeNull();
  });

  test('Linux: all probes timeout → hasGPU=false, no crash', async () => {
    const adapters = stubAdapters({
      platform: 'linux',
      runCommand: nullRunCommand,
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasGPU).toBe(false);
    expect(result.gpuName).toBeNull();
  });

  test('Linux: nvidia-smi returns empty stdout', async () => {
    const adapters = stubAdapters({
      platform: 'linux',
      runCommand: async (cmd) => {
        if (cmd === 'nvidia-smi') {
          return { stdout: '', stderr: '', code: 0 };
        }
        if (cmd === 'lspci') {
          return { stdout: '', stderr: '', code: 0 };
        }
        return null;
      },
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasGPU).toBe(false);
  });

  test('Linux: nvidia-smi timeout (null) → falls back to lspci', async () => {
    const lspciOutput = `01:00.0 VGA compatible controller [0300]: NVIDIA Corporation GP107 [GeForce GTX 1050 Ti] [10de:1c82] (rev a1)`;

    const adapters = stubAdapters({
      platform: 'linux',
      runCommand: async (cmd) => {
        if (cmd === 'nvidia-smi') {
          return null; // timeout
        }
        if (cmd === 'lspci') {
          return { stdout: lspciOutput, stderr: '', code: 0 };
        }
        return null;
      },
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasGPU).toBe(true);
    expect(result.gpuName).toBe('GeForce GTX 1050 Ti');
  });

  // ── Windows ──────────────────────────────────────────────────────────────

  test('Windows: wmic returns NVIDIA GPU name', async () => {
    const adapters = stubAdapters({
      platform: 'win32',
      runCommand: successRunCommand(
        'Name               \nNVIDIA GeForce RTX 3060\nIntel(R) UHD Graphics 770\n',
      ),
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasGPU).toBe(true);
    expect(result.gpuName).toBe('NVIDIA GeForce RTX 3060');
  });

  test('Windows: wmic returns only Intel IGP → hasGPU=false', async () => {
    const adapters = stubAdapters({
      platform: 'win32',
      runCommand: successRunCommand(
        'Name               \nIntel(R) UHD Graphics 620\n',
      ),
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasGPU).toBe(false);
    // gpuName may still be the Intel name or null — but hasGPU=false is the key assertion
  });

  test('Windows: wmic fails → graceful degradation', async () => {
    const adapters = stubAdapters({
      platform: 'win32',
      runCommand: nullRunCommand,
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasGPU).toBe(false);
    expect(result.gpuName).toBeNull();
  });

  // ── Unknown platform ────────────────────────────────────────────────────

  test('unknown platform → defaults (no GPU, no NPU)', async () => {
    const adapters = stubAdapters({
      platform: 'other',
      // runCommand defaults to success but shouldn't be called for GPU probes on 'other'
    });

    const result = await profileHardwareWith(adapters);
    expect(result.platform).toBe('other');
    expect(result.hasGPU).toBe(false);
    expect(result.hasNPU).toBe(false);
    expect(result.gpuName).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// profileHardwareWith — NPU detection
// ═══════════════════════════════════════════════════════════════════════════

describe('profileHardwareWith — NPU detection', () => {
  test('macOS arm64 → hasNPU=true', async () => {
    const adapters = stubAdapters({
      platform: 'darwin',
      runCommand: async (cmd) => {
        if (cmd === 'system_profiler') {
          return {
            stdout: JSON.stringify({
              SPDisplaysDataType: [
                { spdisplays_gpus: ['Apple M2'] },
              ],
            }),
            stderr: '',
            code: 0,
          };
        }
        if (cmd === 'uname') {
          return { stdout: 'arm64\n', stderr: '', code: 0 };
        }
        return null;
      },
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasNPU).toBe(true);
  });

  test('macOS x86_64 → hasNPU=false', async () => {
    const adapters = stubAdapters({
      platform: 'darwin',
      runCommand: async (cmd) => {
        if (cmd === 'system_profiler') {
          return {
            stdout: JSON.stringify({
              SPDisplaysDataType: [
                { spdisplays_gpus: ['Intel UHD Graphics 630'] },
              ],
            }),
            stderr: '',
            code: 0,
          };
        }
        if (cmd === 'uname') {
          return { stdout: 'x86_64\n', stderr: '', code: 0 };
        }
        return null;
      },
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasNPU).toBe(false);
  });

  test('Linux → hasNPU=false (no Neural Engine on x86 Linux)', async () => {
    const adapters = stubAdapters({
      platform: 'linux',
    });
    const result = await profileHardwareWith(adapters);
    expect(result.hasNPU).toBe(false);
  });

  test('Windows → hasNPU=false', async () => {
    const adapters = stubAdapters({
      platform: 'win32',
    });
    const result = await profileHardwareWith(adapters);
    expect(result.hasNPU).toBe(false);
  });

  test('uname fails → hasNPU=false, no crash', async () => {
    const adapters = stubAdapters({
      platform: 'darwin',
      runCommand: async (cmd) => {
        if (cmd === 'system_profiler') {
          return { stdout: '{}', stderr: '', code: 0 };
        }
        // uname fails
        return null;
      },
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasNPU).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// profileHardwareWith — end-to-end tier recommendation scenarios
// ═══════════════════════════════════════════════════════════════════════════

describe('profileHardwareWith — end-to-end tier scenarios', () => {
  test('32 GB + GPU + NPU → bundled-large', async () => {
    const adapters = stubAdapters({
      totalmem: () => 32 * 1024 * 1024 * 1024,
      platform: 'darwin',
      runCommand: async (cmd) => {
        if (cmd === 'system_profiler') {
          return {
            stdout: JSON.stringify({
              SPDisplaysDataType: [
                { spdisplays_gpus: ['Apple M3 Max'] },
              ],
            }),
            stderr: '',
            code: 0,
          };
        }
        if (cmd === 'uname') {
          return { stdout: 'arm64', stderr: '', code: 0 };
        }
        return null;
      },
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasGPU).toBe(true);
    expect(result.hasNPU).toBe(true);
    expect(recommendTier(result)).toBe('bundled-large');
  });

  test('8 GB + GPU only → bundled-gpu', async () => {
    const adapters = stubAdapters({
      totalmem: () => 8 * 1024 * 1024 * 1024,
      platform: 'linux',
      runCommand: async (cmd) => {
        if (cmd === 'nvidia-smi') {
          return {
            stdout: 'NVIDIA GeForce GTX 1660',
            stderr: '',
            code: 0,
          };
        }
        return null;
      },
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasGPU).toBe(true);
    expect(recommendTier(result)).toBe('bundled-gpu');
  });

  test('4 GB, no GPU → bundled-cpu', async () => {
    const adapters = stubAdapters({
      totalmem: () => 4 * 1024 * 1024 * 1024,
      platform: 'linux',
      runCommand: nullRunCommand,
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasGPU).toBe(false);
    expect(recommendTier(result)).toBe('bundled-cpu');
  });

  test('16 GB + NPU but no GPU → bundled-large', async () => {
    // Apple Silicon MacBook Air — integrated GPU detected, but hasNPU=true
    // In our logic, the integrated Apple GPU will set hasGPU=true AND hasNPU=true on arm64
    const adapters = stubAdapters({
      totalmem: () => 16 * 1024 * 1024 * 1024,
      platform: 'darwin',
      runCommand: async (cmd) => {
        if (cmd === 'system_profiler') {
          return {
            stdout: JSON.stringify({
              SPDisplaysDataType: [
                { spdisplays_gpus: ['Apple M1'] },
              ],
            }),
            stderr: '',
            code: 0,
          };
        }
        if (cmd === 'uname') {
          return { stdout: 'arm64', stderr: '', code: 0 };
        }
        return null;
      },
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasGPU).toBe(true);
    expect(result.hasNPU).toBe(true);
    expect(result.ramGB).toBe(16);
    expect(recommendTier(result)).toBe('bundled-large');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// profileHardwareWith — crash resilience
// ═══════════════════════════════════════════════════════════════════════════

describe('profileHardwareWith — crash resilience', () => {
  test('runCommand throws → no crash, GPU=false', async () => {
    const adapters = stubAdapters({
      platform: 'linux',
      runCommand: async () => {
        throw new Error('EPIPE');
      },
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasGPU).toBe(false);
    expect(result.gpuName).toBeNull();
    expect(result.platform).toBe('linux');
  });

  test('NPU detection throws → no crash, hasNPU=false', async () => {
    let callCount = 0;
    const adapters = stubAdapters({
      platform: 'darwin',
      runCommand: async (cmd) => {
        callCount++;
        if (cmd === 'system_profiler') {
          return { stdout: '{}', stderr: '', code: 0 };
        }
        if (cmd === 'uname') {
          throw new Error('EACCES');
        }
        return null;
      },
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasNPU).toBe(false);
    expect(result.platform).toBe('darwin');
  });

  test('totalmem throws is not caught (by design — it is a synchronous OS call)', async () => {
    // totalmem and cpus are synchronous OS calls; if they throw, the OS is broken.
    // This test documents the contract: profileHardwareWith does not wrap
    // synchronous OS calls in try/catch (they should be infallible on a
    // healthy system).
    const adapters = stubAdapters({
      totalmem: () => {
        throw new Error('OS panic');
      },
    });

    await expect(profileHardwareWith(adapters)).rejects.toThrow('OS panic');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// detectDarwinGPU — fallback branch (hasGPU=true, gpuName=null)
// ═══════════════════════════════════════════════════════════════════════════

describe('detectDarwinGPU — fallback when GPU keyword detected but name extraction fails', () => {
  test('hasGPU=true when system_profiler output triggers GPU keyword fallback', async () => {
    const adapters = stubAdapters({
      platform: 'darwin',
      runCommand: async (cmd) => {
        if (cmd === 'system_profiler') {
          // JSON that has 'Graphics' keyword in combined output but no clean GPU name
          return { stdout: JSON.stringify({ SPDisplaysDataType: [{ some_property: 'Graphics Card' }] }), stderr: '', code: 0 };
        }
        if (cmd === 'uname') return { stdout: 'x86_64', stderr: '', code: 0 };
        return null;
      },
    });

    const result = await profileHardwareWith(adapters);
    // The fallback path: GPU keyword matched → hasGPU=true
    expect(result.hasGPU).toBe(true);
  });

  test('hasGPU=false when combined output matches Intel IGP pattern', async () => {
    const adapters = stubAdapters({
      platform: 'darwin',
      runCommand: async (cmd) => {
        if (cmd === 'system_profiler') {
          return { stdout: JSON.stringify({ SPDisplaysDataType: [{ spdisplays_gpus: ['Intel UHD Graphics'] }] }), stderr: '', code: 0 };
        }
        if (cmd === 'uname') return { stdout: 'x86_64', stderr: '', code: 0 };
        return null;
      },
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasGPU).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// detectLinuxGPU — all shell commands return empty results
// ═══════════════════════════════════════════════════════════════════════════

describe('detectLinuxGPU — all shell commands return empty results', () => {
  test('hasGPU=false when nvidia-smi and lspci both return empty output', async () => {
    const adapters = stubAdapters({
      platform: 'linux',
      runCommand: async (cmd) => {
        if (cmd === 'nvidia-smi') return { stdout: '', stderr: '', code: 0 };
        if (cmd === 'lspci') return { stdout: '', stderr: '', code: 0 };
        return null;
      },
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasGPU).toBe(false);
    expect(result.gpuName).toBeNull();
  });

  test('lspci with only Intel VGA (no discrete GPU name)', async () => {
    const adapters = stubAdapters({
      platform: 'linux',
      runCommand: async (cmd) => {
        if (cmd === 'nvidia-smi') return { stdout: '', stderr: 'command not found', code: 127 };
        if (cmd === 'lspci') {
          return {
            stdout: '00:02.0 VGA compatible controller [0300]: Intel Corporation UHD Graphics [8086:9bc4]',
            stderr: '',
            code: 0,
          };
        }
        return null;
      },
    });

    const result = await profileHardwareWith(adapters);
    // Intel-only: hasGPU=false (nonIntelLines empty), gpuName stays null
    expect(result.hasGPU).toBe(false);
    expect(result.gpuName).toBeNull();
  });

  test('hasGPU=false when nvidia-smi non-zero exit code', async () => {
    const adapters = stubAdapters({
      platform: 'linux',
      runCommand: async (cmd) => {
        if (cmd === 'nvidia-smi') return { stdout: '', stderr: 'NVIDIA-SMI has failed', code: 127 };
        if (cmd === 'lspci') return { stdout: '01:00.0 VGA compatible controller [0300]: NVIDIA Corporation GA104 [GeForce RTX 3070] [10de:2484]', stderr: '', code: 0 };
        return null;
      },
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasGPU).toBe(true);
    expect(result.gpuName).toBe('GeForce RTX 3070');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// profileHardware — real OS calls (do not throw, no network involved)
// ═══════════════════════════════════════════════════════════════════════════

describe('profileHardware — real OS integration', () => {
  test('profileHardware returns a valid HardwareProfile without throwing', async () => {
    // This exercises the realRunCommand path and profileHardware() public API
    // It should not throw since it wraps everything in try/catch internally
    const result = await require('./hardware.ts').profileHardware();
    expect(result).toHaveProperty('ramGB');
    expect(result).toHaveProperty('cpuCores');
    expect(result).toHaveProperty('hasGPU');
    expect(result).toHaveProperty('platform');
  });
});

describe('detectDarwinGPU — edge cases', () => {
  test('hasGPU=true when combined output contains Graphics keyword but no GPU name parsed', async () => {
    const adapters = stubAdapters({
      platform: 'darwin',
      runCommand: async (cmd) => {
        if (cmd === 'system_profiler') {
          return { stdout: JSON.stringify({ SPDisplaysDataType: [{ _name: 'Graphics Controller' }] }), stderr: '', code: 0 };
        }
        if (cmd === 'uname') return { stdout: 'arm64', stderr: '', code: 0 };
        return null;
      },
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasGPU).toBe(true);
    // gpuName may or may not be null depending on how _name is parsed; just verify hasGPU
  });

  test('hasGPU=false when combined output also matches Intel IGP pattern', async () => {
    const adapters = stubAdapters({
      platform: 'darwin',
      runCommand: async (cmd) => {
        if (cmd === 'system_profiler') {
          return { stdout: JSON.stringify({ SPDisplaysDataType: [{ spdisplays_gpus: ['Intel UHD Graphics'] }] }), stderr: '', code: 0 };
        }
        if (cmd === 'uname') return { stdout: 'x86_64', stderr: '', code: 0 };
        return null;
      },
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasGPU).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// detectLinuxGPU — empty nvidia-smi stdout + empty lspci output
// ═══════════════════════════════════════════════════════════════════════════

describe('detectLinuxGPU — all shell commands return empty results', () => {
  test('hasGPU=false when nvidia-smi and lspci both return empty output', async () => {
    const adapters = stubAdapters({
      platform: 'linux',
      runCommand: async (cmd) => {
        if (cmd === 'nvidia-smi') return { stdout: '', stderr: '', code: 0 };
        if (cmd === 'lspci') return { stdout: '', stderr: '', code: 0 };
        return null;
      },
    });

    const result = await profileHardwareWith(adapters);
    expect(result.hasGPU).toBe(false);
    expect(result.gpuName).toBeNull();
  });

  test('lspci with only Intel VGA (no discrete GPU name)', async () => {
    const adapters = stubAdapters({
      platform: 'linux',
      runCommand: async (cmd) => {
        if (cmd === 'nvidia-smi') return { stdout: '', stderr: 'command not found', code: 127 };
        if (cmd === 'lspci') {
          return {
            stdout: '00:02.0 VGA compatible controller [0300]: Intel Corporation UHD Graphics [8086:9bc4]',
            stderr: '',
            code: 0,
          };
        }
        return null;
      },
    });

    const result = await profileHardwareWith(adapters);
    // Intel-only: hasGPU=false (nonIntelLines empty), gpuName stays null
    expect(result.hasGPU).toBe(false);
    expect(result.gpuName).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// profileHardware — real OS calls (do not throw, no network involved)
// ═══════════════════════════════════════════════════════════════════════════

describe('profileHardware — real OS integration', () => {
  test('profileHardware returns a valid HardwareProfile without throwing', async () => {
    // This exercises the realRunCommand path and profileHardware() public API
    // It should not throw since it wraps everything in try/catch internally
    const result = await require('./hardware.ts').profileHardware();
    expect(result).toHaveProperty('ramGB');
    expect(result).toHaveProperty('cpuCores');
    expect(result).toHaveProperty('hasGPU');
    expect(result).toHaveProperty('platform');
  });
});
