export interface RegistryEntry {
  id: string;
  source: 'anthropic' | 'smithery' | 'bundled';
  name: string;
  displayName: string;
  description: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  command?: string[];
  url?: string;
  iconUrl?: string;
  useCases?: string[];
  toolNames?: string[];
  homepage?: string;
  oneLiner?: string;
}
