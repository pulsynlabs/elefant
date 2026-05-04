import type { Message } from '../types/providers.ts';

export interface CompactionInput {
  messages: Message[];
  tokenCount: number;
  contextWindow: number;
  sessionId: string;
  conversationId: string;
  discoveredTools?: string[];
}

export interface CompactionOutput {
  messages: Message[];
  summary: string;
  blocks: string[];
  tokenCountBefore: number;
  tokenCountAfter: number;
  discoveredTools?: string[];
  didCompact?: boolean;
  skipReason?: 'pending_tool_call' | 'hook_cancelled';
}
