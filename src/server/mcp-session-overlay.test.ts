import { describe, expect, it } from 'bun:test'

import type { ToolWithMeta } from '../mcp/types.ts'
import { filterToolsForSessionOverlay, MCPSessionOverlay } from './mcp-session-overlay.ts'

function mockTool(serverId: string, toolName: string): ToolWithMeta {
	return {
		serverId,
		serverName: serverId,
		tool: {
			name: toolName,
			inputSchema: { type: 'object', properties: {} },
		} as ToolWithMeta['tool'],
	}
}

describe('MCPSessionOverlay', () => {
	it('disable is scoped to a single session', () => {
		const overlay = new MCPSessionOverlay()
		overlay.disable('session-a', 'server-x')

		expect(overlay.isDisabled('session-a', 'server-x')).toBe(true)
		expect(overlay.isDisabled('session-b', 'server-x')).toBe(false)
	})

	it('enable reverses a prior disable', () => {
		const overlay = new MCPSessionOverlay()
		overlay.disable('session-a', 'server-x')
		overlay.enable('session-a', 'server-x')

		expect(overlay.isDisabled('session-a', 'server-x')).toBe(false)
	})

	it('clearSession removes one session state only', () => {
		const overlay = new MCPSessionOverlay()
		overlay.disable('session-a', 'server-x')
		overlay.disable('session-b', 'server-x')

		overlay.clearSession('session-a')

		expect(overlay.isDisabled('session-a', 'server-x')).toBe(false)
		expect(overlay.isDisabled('session-b', 'server-x')).toBe(true)
	})

	it('filters tool list by disabled servers for a session', () => {
		const overlay = new MCPSessionOverlay()
		const tools = [
			mockTool('server-a', 'tool-1'),
			mockTool('server-b', 'tool-2'),
			mockTool('server-c', 'tool-3'),
		]

		overlay.disable('session-a', 'server-b')
		const filtered = filterToolsForSessionOverlay(tools, 'session-a', overlay)

		expect(filtered).toHaveLength(2)
		expect(filtered.map((entry) => entry.serverId)).toEqual(['server-a', 'server-c'])
	})
})
