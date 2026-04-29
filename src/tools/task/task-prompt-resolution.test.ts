import { describe, expect, it } from 'bun:test'

import { defaultAgentProfiles, type AgentProfile } from '../../config/index.ts'
import { ok, err } from '../../types/result.ts'
import { resolveAgentPrompt } from './index.ts'

function createConfigManager(profileByAgent: Record<string, AgentProfile>) {
	return {
		resolve: async (agentId: string) => {
			const profile = profileByAgent[agentId]
			if (!profile) {
				return err({ code: 'FILE_NOT_FOUND' as const, message: `Agent ${agentId} not found` })
			}

			return ok({
				...profile,
				_sources: {},
			})
		},
	} as Parameters<typeof resolveAgentPrompt>[1]
}

describe('task agent prompt resolution', () => {
	it('resolves prompt_file content at runtime', async () => {
		const configManager = createConfigManager({
			planner: defaultAgentProfiles.planner,
		})

		const prompt = await resolveAgentPrompt('planner', configManager)

		expect(prompt).not.toBeNull()
		expect(prompt).toContain('# Planner — The Architect')
	})

	it('uses prompt_override before prompt_file', async () => {
		const configManager = createConfigManager({
			planner: {
				...defaultAgentProfiles.planner,
				promptOverride: '# Custom Planner Prompt',
			},
		})

		const prompt = await resolveAgentPrompt('planner', configManager)

		expect(prompt).toBe('# Custom Planner Prompt')
	})

	it('returns null when no prompt source is configured', async () => {
		const configManager = createConfigManager({
			custom: {
				...defaultAgentProfiles.default,
				id: 'custom',
				label: 'Custom',
				kind: 'custom',
				promptFile: null,
				promptOverride: null,
			},
		})

		const prompt = await resolveAgentPrompt('custom', configManager)

		expect(prompt).toBeNull()
	})

	it('returns null for unknown subagent_type', async () => {
		const configManager = createConfigManager({})

		const prompt = await resolveAgentPrompt('missing-agent', configManager)

		expect(prompt).toBeNull()
	})

	it('verifier profile defaults to fresh context', () => {
		expect(defaultAgentProfiles.verifier.contextMode).toBe('none')
	})
})
