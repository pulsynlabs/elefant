import type { Message, ProviderConfig } from '../types/providers.ts'
import type { ToolCall, ToolDefinition } from '../types/tools.ts'
import type { ProviderAdapter, SendMessageOptions, StreamEvent } from './types.ts'
import { parseSseEvents } from './sse.ts'

interface AnthropicContentBlockStart {
	index?: number
	content_block?: {
		type?: string
		id?: string
		name?: string
	}
	type?: string
	id?: string
	name?: string
}

interface AnthropicContentBlockDelta {
	index?: number
	delta?: {
		type?: string
		text?: string
		partial_json?: string
	}
	type?: string
	text?: string
	partial_json?: string
}

interface AnthropicMessageDelta {
	delta?: {
		stop_reason?: string | null
	}
	stop_reason?: string | null
}

interface PendingToolUseBlock {
	id: string
	name: string
	arguments: string
}

function buildAnthropicEndpoint(baseURL: string): string {
	const normalized = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL
	if (normalized.endsWith('/v1')) {
		return `${normalized}/messages`
	}

	return `${normalized}/v1/messages`
}

function resolveRequiredFields(parameters: ToolDefinition['parameters']): string[] {
	return Object.entries(parameters)
		.filter(([, value]) => value.required === true)
		.map(([key]) => key)
}

function toAnthropicTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
	return tools.map((tool) => {
		const required = resolveRequiredFields(tool.parameters)
		const inputSchema: Record<string, unknown> = {
			type: 'object',
			properties: tool.parameters,
		}

		if (required.length > 0) {
			inputSchema.required = required
		}

		return {
			name: tool.name,
			description: tool.description,
			input_schema: inputSchema,
		}
	})
}

function toAnthropicMessages(messages: Message[]): {
	system?: string
	messages: Array<Record<string, unknown>>
	error?: StreamEvent
} {
	const systemParts: string[] = []
	const anthropicMessages: Array<Record<string, unknown>> = []

	for (const message of messages) {
		if (message.role === 'system') {
			systemParts.push(message.content)
			continue
		}

		if (message.role === 'tool') {
			if (!message.toolCallId) {
				return {
					messages: [],
					error: {
						type: 'error',
						error: {
							code: 'PROVIDER_ERROR',
							message: 'Tool messages must include toolCallId',
						},
					},
				}
			}

			anthropicMessages.push({
				role: 'user',
				content: [
					{
						type: 'tool_result',
						tool_use_id: message.toolCallId,
						content: message.content,
					},
				],
			})
			continue
		}

		if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
			const contentBlocks: Array<Record<string, unknown>> = []

			if (message.content.trim().length > 0) {
				contentBlocks.push({
					type: 'text',
					text: message.content,
				})
			}

			for (const toolCall of message.toolCalls) {
				contentBlocks.push({
					type: 'tool_use',
					id: toolCall.id,
					name: toolCall.name,
					input: toolCall.arguments,
				})
			}

			anthropicMessages.push({
				role: 'assistant',
				content: contentBlocks,
			})
			continue
		}

		anthropicMessages.push({
			role: message.role,
			content: message.content,
		})
	}

	return {
		system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
		messages: anthropicMessages,
	}
}

function parseToolArguments(rawArguments: string): Record<string, unknown> {
	if (rawArguments.trim() === '') {
		return {}
	}

	const parsed = JSON.parse(rawArguments) as unknown
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error('Tool call arguments must be a JSON object')
	}

	return parsed as Record<string, unknown>
}

function extractContentBlockStart(data: AnthropicContentBlockStart): { index?: number; type?: string; id?: string; name?: string } {
	const block = data.content_block
	return {
		index: data.index,
		type: block?.type ?? data.type,
		id: block?.id ?? data.id,
		name: block?.name ?? data.name,
	}
}

function extractContentBlockDelta(data: AnthropicContentBlockDelta): { index?: number; type?: string; text?: string; partialJson?: string } {
	const delta = data.delta
	return {
		index: data.index,
		type: delta?.type ?? data.type,
		text: delta?.text ?? data.text,
		partialJson: delta?.partial_json ?? data.partial_json,
	}
}

function extractStopReason(data: AnthropicMessageDelta): string | null | undefined {
	return data.delta?.stop_reason ?? data.stop_reason
}

function createProviderError(message: string, details?: unknown): StreamEvent {
	return {
		type: 'error',
		error: {
			code: 'PROVIDER_ERROR',
			message,
			details,
		},
	}
}

function mapStopReason(reason: string | null | undefined): 'stop' | 'tool_calls' | 'length' {
	if (reason === 'tool_use') {
		return 'tool_calls'
	}

	if (reason === 'max_tokens') {
		return 'length'
	}

	return 'stop'
}

export class AnthropicAdapter implements ProviderAdapter {
	public readonly name: string
	private readonly config: ProviderConfig

	constructor(config: ProviderConfig) {
		this.config = config
		this.name = config.name
	}

	public async *sendMessage(
		messages: Message[],
		tools: ToolDefinition[],
		options?: SendMessageOptions,
	): AsyncGenerator<StreamEvent> {
		const normalizedMessages = toAnthropicMessages(messages)
		if (normalizedMessages.error) {
			yield normalizedMessages.error
			return
		}

		const endpoint = buildAnthropicEndpoint(this.config.baseURL)
		const requestBody: Record<string, unknown> = {
			model: this.config.model,
			messages: normalizedMessages.messages,
			tools: toAnthropicTools(tools),
			stream: true,
			max_tokens: typeof options?.maxTokens === 'number' ? options.maxTokens : 8192,
		}

		if (typeof normalizedMessages.system === 'string' && normalizedMessages.system.length > 0) {
			requestBody.system = normalizedMessages.system
		}

		if (typeof options?.temperature === 'number') {
			requestBody.temperature = options.temperature
		}

		if (typeof options?.topP === 'number') {
			requestBody.top_p = options.topP
		}

		let response: Response
		try {
			response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'anthropic-version': '2023-06-01',
					'x-api-key': this.config.apiKey,
				},
				body: JSON.stringify(requestBody),
				signal: options?.signal,
			})
		} catch (error) {
			yield createProviderError('Network request to Anthropic failed', error)
			return
		}

		if (!response.ok) {
			const responseBody = await response.text().catch(() => '')
			yield createProviderError(`Anthropic request failed with status ${response.status}`, {
				status: response.status,
				body: responseBody,
			})
			return
		}

		if (!response.body) {
			yield createProviderError('Anthropic response body is empty')
			return
		}

		const pendingToolUses = new Map<number, PendingToolUseBlock>()
		let doneEmitted = false

		// Usage tracking variables
		let inputTokens = 0
		let outputTokens = 0
		let cacheReadTokens: number | undefined
		let cacheWriteTokens: number | undefined

		for await (const sseEvent of parseSseEvents(response.body)) {
			let data: unknown
			try {
				data = JSON.parse(sseEvent.data)
			} catch (error) {
				yield createProviderError('Failed to parse Anthropic SSE chunk', {
					event: sseEvent.event,
					chunk: sseEvent.data,
					error,
				})
				return
			}

			if (sseEvent.event === 'message_start') {
				const messageStartData = data as {
					message?: {
						usage?: {
							input_tokens?: number
							cache_read_input_tokens?: number
							cache_creation_input_tokens?: number
						}
					}
				}
				const usage = messageStartData.message?.usage
				if (usage) {
					if (typeof usage.input_tokens === 'number') {
						inputTokens = usage.input_tokens
					}
					if (typeof usage.cache_read_input_tokens === 'number') {
						cacheReadTokens = usage.cache_read_input_tokens
					}
					if (typeof usage.cache_creation_input_tokens === 'number') {
						cacheWriteTokens = usage.cache_creation_input_tokens
					}
				}
				continue
			}

			if (sseEvent.event === 'content_block_start') {
				const start = extractContentBlockStart(data as AnthropicContentBlockStart)
				if (
					start.type === 'tool_use'
					&& typeof start.index === 'number'
					&& typeof start.id === 'string'
					&& typeof start.name === 'string'
				) {
					pendingToolUses.set(start.index, {
						id: start.id,
						name: start.name,
						arguments: '',
					})

					yield {
						type: 'tool_call_start',
						toolCall: {
							id: start.id,
							name: start.name,
						},
					}
				}
				continue
			}

			if (sseEvent.event === 'content_block_delta') {
				const delta = extractContentBlockDelta(data as AnthropicContentBlockDelta)

				if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) {
					yield {
						type: 'text_delta',
						text: delta.text,
					}
					continue
				}

				if (delta.type === 'input_json_delta' && typeof delta.partialJson === 'string') {
					const pending = typeof delta.index === 'number' ? pendingToolUses.get(delta.index) : undefined
					if (pending) {
						pending.arguments += delta.partialJson
						yield {
							type: 'tool_call_delta',
							toolCallId: pending.id,
							argumentsDelta: delta.partialJson,
						}
					}
				}
				continue
			}

			if (sseEvent.event === 'content_block_stop') {
				if (typeof data !== 'object' || data === null) {
					continue
				}

				const stopData = data as { index?: unknown }
				if (typeof stopData.index !== 'number') {
					continue
				}

				const pending = pendingToolUses.get(stopData.index)
				if (!pending) {
					continue
				}

				let parsedArguments: Record<string, unknown>
				try {
					parsedArguments = parseToolArguments(pending.arguments)
				} catch (error) {
					yield createProviderError('Failed to parse Anthropic tool call arguments', {
						toolCallId: pending.id,
						rawArguments: pending.arguments,
						error,
					})
					pendingToolUses.delete(stopData.index)
					continue
				}

				const completedToolCall: ToolCall = {
					id: pending.id,
					name: pending.name,
					arguments: parsedArguments,
				}

				yield {
					type: 'tool_call_complete',
					toolCall: completedToolCall,
				}

				pendingToolUses.delete(stopData.index)
				continue
			}

			if (sseEvent.event === 'message_delta') {
				const messageDeltaData = data as AnthropicMessageDelta & {
					usage?: {
						output_tokens?: number
					}
				}

				// Parse output tokens from usage field
				if (messageDeltaData.usage?.output_tokens !== undefined) {
					outputTokens = messageDeltaData.usage.output_tokens
				}

				const stopReason = extractStopReason(messageDeltaData)
				if (stopReason) {
					yield {
						type: 'done',
						finishReason: mapStopReason(stopReason),
					}
					doneEmitted = true
				}
				continue
			}

			if (sseEvent.event === 'message_stop') {
				if (!doneEmitted) {
					yield {
						type: 'done',
						finishReason: 'stop',
					}
				}

				// Yield usage event if we have any token data
				if (inputTokens > 0 || outputTokens > 0) {
					const usageEvent: StreamEvent = {
						type: 'usage',
						inputTokens,
						outputTokens,
					}
					if (cacheReadTokens !== undefined) {
						usageEvent.cacheReadTokens = cacheReadTokens
					}
					if (cacheWriteTokens !== undefined) {
						usageEvent.cacheWriteTokens = cacheWriteTokens
					}
					yield usageEvent
				}

				return
			}

			if (sseEvent.event === 'error') {
				const errorPayload = data as { error?: { message?: string }; message?: string }
				yield createProviderError(
					errorPayload.error?.message ?? errorPayload.message ?? 'Anthropic stream returned an error event',
					errorPayload,
				)
				return
			}
		}
	}
}
