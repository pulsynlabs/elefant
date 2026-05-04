import type { ToolWithMeta } from '../mcp/types.ts'

/**
 * In-memory per-session MCP server overlay.
 *
 * IMPORTANT INVARIANT:
 * This overlay never reads from or writes to persistent MCP configuration.
 * It only tracks session-scoped disabled servers in memory.
 */
export class MCPSessionOverlay {
	private readonly overlay = new Map<string, Set<string>>()

	disable(sessionId: string, serverId: string): void {
		const disabled = this.overlay.get(sessionId) ?? new Set<string>()
		disabled.add(serverId)
		this.overlay.set(sessionId, disabled)
	}

	enable(sessionId: string, serverId: string): void {
		const disabled = this.overlay.get(sessionId)
		if (!disabled) {
			return
		}

		disabled.delete(serverId)
		if (disabled.size === 0) {
			this.overlay.delete(sessionId)
		}
	}

	isDisabled(sessionId: string, serverId: string): boolean {
		return this.overlay.get(sessionId)?.has(serverId) ?? false
	}

	getDisabledServers(sessionId: string): Set<string> {
		return new Set(this.overlay.get(sessionId) ?? [])
	}

	clearSession(sessionId: string): void {
		this.overlay.delete(sessionId)
	}
}

export function filterToolsForSessionOverlay(tools: ToolWithMeta[], sessionId: string, overlay: MCPSessionOverlay): ToolWithMeta[] {
	return tools.filter((entry) => !overlay.isDisabled(sessionId, entry.serverId))
}

export const mcpSessionOverlay = new MCPSessionOverlay()
