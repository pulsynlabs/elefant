import { existsSync } from 'node:fs';

import type { DaemonContext } from '../daemon/context.ts';
import { insertEvent } from '../db/repo/events.ts';
import { emit } from '../hooks/emit.ts';
import type { StateManager } from '../state/manager.ts';
import type { Message } from '../types/providers.ts';
import {
  buildAdlBlock,
  buildSpecBlock,
  buildStateBlock,
  buildToolInstructionsBlock,
} from './blocks.ts';
import type { CompactionInput, CompactionOutput } from './types.ts';

const COMPACTION_THRESHOLD = 0.7;
const RETAINED_MESSAGE_RATIO = 0.3;

function estimateTokens(messages: Message[]): number {
  const content = messages
    .map((message) => {
      if (typeof message.content === 'string') {
        return message.content;
      }

      return JSON.stringify(message.content);
    })
    .join(' ');

  return Math.ceil(content.length / 4);
}

export class CompactionManager {
  constructor(private readonly ctx: DaemonContext) {}

  shouldCompact(tokenCount: number, contextWindow: number): boolean {
    return tokenCount > contextWindow * COMPACTION_THRESHOLD;
  }

  async compact(input: CompactionInput): Promise<CompactionOutput> {
    const {
      messages,
      tokenCount,
      contextWindow,
      sessionId,
      conversationId,
    } = input;

    const hookContext = await emit(this.ctx.hooks, 'session:compact', {
      messages,
      tokenCount,
      contextWindow,
      summary: undefined,
    });

    let summary: string;
    if (typeof hookContext.summary === 'string' && hookContext.summary.length > 0) {
      summary = hookContext.summary;
    } else {
      const kept = Math.floor(messages.length * RETAINED_MESSAGE_RATIO);
      const truncated = messages.length - kept;
      summary = `[Compaction: ${truncated} messages summarized. ${kept} most recent messages retained.]`;
    }

    const state = this.ctx.state.getState();
    const specPath = this.resolveSpecPath(state);
    const toolNames = this.getToolNames();

    const blocks = [
      buildStateBlock(state),
      buildSpecBlock(specPath),
      buildAdlBlock(this.ctx.db),
      buildToolInstructionsBlock(toolNames),
    ].filter((block) => block.length > 0);

    const keptMessages = messages.slice(
      -Math.floor(messages.length * RETAINED_MESSAGE_RATIO),
    );

    const summaryMessage: Message = {
      role: 'user',
      content: `[Context compacted at ${new Date().toISOString()}]\n\nSummary of previous work:\n${summary}`,
    };
    const blockMessages: Message[] = blocks.map((block) => ({
      role: 'system',
      content: block,
    }));
    const compactedMessages = [summaryMessage, ...blockMessages, ...keptMessages];
    const tokenCountAfter = estimateTokens(compactedMessages);

    try {
      insertEvent(this.ctx.db, {
        id: crypto.randomUUID(),
        session_id: sessionId,
        type: 'compaction',
        data: JSON.stringify({
          tokenCountBefore: tokenCount,
          tokenCountAfter,
          messagesBefore: messages.length,
          messagesAfter: compactedMessages.length,
          conversationId,
        }),
      });
    } catch {
      // Non-fatal persistence path.
    }

    return {
      messages: compactedMessages,
      summary,
      blocks,
      tokenCountBefore: tokenCount,
      tokenCountAfter,
    };
  }

  private resolveSpecPath(
    state: ReturnType<StateManager['getState']>,
  ): string | null {
    const workflowId = state.workflow.workflowId;
    const projectPath = state.project.path;
    const candidates = [
      workflowId ? `${projectPath}/.goopspec/${workflowId}/SPEC.md` : null,
      `${projectPath}/.goopspec/SPEC.md`,
      `${projectPath}/.elefant/SPEC.md`,
    ];

    for (const candidate of candidates) {
      if (candidate && existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private getToolNames(): string[] {
    return this.ctx.tools.getAll().map((tool) => tool.name);
  }
}
