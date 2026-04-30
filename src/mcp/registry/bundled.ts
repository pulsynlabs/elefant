import type { RegistryEntry } from './types.ts';
import bundledData from './bundled.json' with { type: 'json' };

export function getBundledRegistry(): RegistryEntry[] {
  return bundledData as RegistryEntry[];
}
