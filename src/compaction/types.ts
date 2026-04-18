import type { Message } from '../types/providers.ts';

export interface CompactionInput {
  messages: Message[];
  tokenCount: number;
  contextWindow: number;
  sessionId: string;
  conversationId: string;
}

export interface CompactionOutput {
  messages: Message[];
  summary: string;
  blocks: string[];
  tokenCountBefore: number;
  tokenCountAfter: number;
}
