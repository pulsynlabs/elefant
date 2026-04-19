import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Database } from '../db/database.ts';
import type { HookHandler } from '../hooks/types.ts';
import type { StateManager } from '../state/manager.ts';
import type { Message } from '../types/providers.ts';

export interface BlockBuilder {
	readonly name: string;
	render: () => string;
}

const fileContentCache = new Map<string, string>();
const fileReadCountByPath = new Map<string, number>();

export function __resetFileBlockCacheForTests(): void {
	fileContentCache.clear();
	fileReadCountByPath.clear();
}

export function __getFileReadCountForTests(filePath: string): number {
	const absolutePath = resolve(filePath);
	return fileReadCountByPath.get(absolutePath) ?? 0;
}

function readFileWithMtimeCache(filePath: string): string | null {
	try {
		const absolutePath = resolve(filePath);
		const stats = statSync(absolutePath);
		const key = `${absolutePath}:${stats.mtimeMs}`;

		const cached = fileContentCache.get(key);
		if (typeof cached === 'string') {
			return cached;
		}

		for (const staleKey of fileContentCache.keys()) {
			if (staleKey.startsWith(`${absolutePath}:`)) {
				fileContentCache.delete(staleKey);
			}
		}

		const content = readFileSync(absolutePath, 'utf-8');
		fileContentCache.set(key, content);
		fileReadCountByPath.set(
			absolutePath,
			(fileReadCountByPath.get(absolutePath) ?? 0) + 1,
		);

		return content;
	} catch {
		return null;
	}
}

function estimateContentTokens(content: string): number {
	// V1 heuristic: approximate token count at 1 token per 4 chars.
	return Math.ceil(content.length / 4);
}

function splitLeadingSystemMessages(messages: Message[]): {
	fixedSystemHeader: Message[];
	rest: Message[];
} {
	const fixedSystemHeader: Message[] = [];
	let index = 0;

	while (index < messages.length && messages[index]?.role === 'system') {
		fixedSystemHeader.push(messages[index]);
		index += 1;
	}

	return {
		fixedSystemHeader,
		rest: messages.slice(index),
	};
}

function clampInjectedMessages(
	injectedMessages: Message[],
	budgetTokens: number,
): {
	messages: Message[];
	totalTokens: number;
	clampedTokens: number;
	wasClamped: boolean;
} {
	const totalTokens = injectedMessages.reduce((sum, message) => {
		return sum + estimateContentTokens(message.content);
	}, 0);

	if (budgetTokens <= 0) {
		return {
			messages: [],
			totalTokens,
			clampedTokens: 0,
			wasClamped: totalTokens > 0,
		};
	}

	if (totalTokens <= budgetTokens) {
		return {
			messages: injectedMessages,
			totalTokens,
			clampedTokens: totalTokens,
			wasClamped: false,
		};
	}

	const clamped: Message[] = [];
	let usedTokens = 0;

	for (const message of injectedMessages) {
		const messageTokens = estimateContentTokens(message.content);
		if (usedTokens + messageTokens <= budgetTokens) {
			clamped.push(message);
			usedTokens += messageTokens;
			continue;
		}

		const remainingTokens = budgetTokens - usedTokens;
		if (remainingTokens <= 0) {
			break;
		}

		const allowedChars = remainingTokens * 4;
		clamped.push({
			...message,
			content: message.content.slice(0, allowedChars),
		});
		usedTokens += estimateContentTokens(message.content.slice(0, allowedChars));
		break;
	}

	return {
		messages: clamped,
		totalTokens,
		clampedTokens: usedTokens,
		wasClamped: true,
	};
}

export function createCompactionBlockTransform(opts: {
	blocks: BlockBuilder[];
	budget: number;
}): HookHandler<'system:transform'> {
	return (context) => {
		if (opts.blocks.length === 0) {
			return { messages: context.messages };
		}

		const renderedBlocks: Message[] = [];
		for (const block of opts.blocks) {
			const content = block.render().trim();
			if (content.length === 0) {
				continue;
			}

			renderedBlocks.push({
				role: 'system',
				content,
			});
		}

		if (renderedBlocks.length === 0) {
			return { messages: context.messages };
		}

		const budgetTokens = Math.max(
			0,
			Math.min(opts.budget, context.budgets.tokens),
		);
		const clamped = clampInjectedMessages(renderedBlocks, budgetTokens);
		if (clamped.wasClamped) {
			console.warn(
				`[elefant] system:transform clamped injected context from ${clamped.totalTokens} to ${clamped.clampedTokens} tokens (budget=${budgetTokens})`,
			);
		}

		const { fixedSystemHeader, rest } = splitLeadingSystemMessages(
			context.messages,
		);

		return {
			messages: [...fixedSystemHeader, ...clamped.messages, ...rest],
		};
	};
}

export function buildStateBlock(
  state: ReturnType<StateManager['getState']>,
): string {
  const w = state.workflow;
  return [
    '## 🔮 Workflow State (Survived Compaction)',
    `- Phase: ${w.phase}`,
    `- Mode: ${w.mode}`,
    `- Depth: ${w.depth}`,
    `- Wave: ${w.currentWave}/${w.totalWaves}`,
    `- Spec Locked: ${w.specLocked}`,
    w.workflowId ? `- Workflow ID: ${w.workflowId}` : '',
    '',
    '> Continue from where you left off. Read project state and spec before taking action.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function buildSpecBlock(specPath: string | null): string {
	if (!specPath) {
		return '';
	}

	try {
		const content = readFileWithMtimeCache(specPath);
		if (content === null) {
			return '';
		}
		const lines = content.split('\n');
    if (lines.length <= 200) {
      return `## 📋 Specification Contract\n\n${content}`;
    }

    const sections: string[] = [];
    let inSection = false;

    for (const line of lines) {
      if (line.startsWith('## Must-Haves') || line.startsWith('## Out of Scope')) {
        inSection = true;
        sections.push(line);
        continue;
      }

      if (inSection && line.startsWith('## ')) {
        inSection = false;
        sections.push('');
        continue;
      }

      if (inSection) {
        sections.push(line);
      }
    }

    return sections.length > 0
      ? `## 📋 Specification Contract (Key Sections)\n\n${sections.join('\n')}`
      : '';
  } catch {
    return '';
  }
}

interface AdlEventRow {
  data: string;
  timestamp: string;
}

export function buildAdlBlock(db: Database): string {
  try {
    const rows = db.db
      .query(
        "SELECT data, timestamp FROM events WHERE type IN ('decision', 'adl') ORDER BY timestamp DESC LIMIT 5",
      )
      .all() as AdlEventRow[];

    if (rows.length === 0) {
      return '';
    }

    const entries = rows.map((row) => {
      try {
        const parsed = JSON.parse(row.data) as {
          description?: string;
          action?: string;
        };
        return `- [${row.timestamp}] ${parsed.description ?? ''} → ${parsed.action ?? ''}`;
      } catch {
        return `- [${row.timestamp}] ${row.data}`;
      }
    });

    return [
      '## 📝 Recent Decisions (ADL)',
      '> These decisions have already been made. Honor them.',
      '',
      ...entries,
    ].join('\n');
  } catch {
    return '';
  }
}

export function buildToolInstructionsBlock(toolNames: string[]): string {
  if (toolNames.length === 0) {
    return '';
  }

  return [
    '## 🔧 Available Tools',
    '> After resuming from compaction, run status checks before taking action.',
    '',
    `Tools registered: ${toolNames.join(', ')}`,
  ].join('\n');
}
