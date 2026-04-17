import type { ElefantError } from '../types/errors.ts'
import type { Message, ProviderConfig } from '../types/providers.ts'
import type { ToolCall, ToolDefinition } from '../types/tools.ts'
import type { ProviderAdapter, SendMessageOptions, StreamEvent } from './types.ts'
import { parseSseEvents } from './sse.ts'

interface OpenAIStreamToolCallDelta {
	index: number
	id?: string
	function?: {
		name?: string
		arguments?: string
	}
}

interface OpenAIStreamDelta {
	content?: string
	tool_calls?: OpenAIStreamToolCallDelta[]
}

interface OpenAIChoice {
	delta?: OpenAIStreamDelta
	finish_reason?: 'stop' | 'tool_calls' | 'length' | null
}

interface OpenAIChunk {
	choices?: OpenAIChoice[]
}

interface PendingToolCall {
	id?: string
	name?: string
	arguments: string
	startEmitted: boolean
}

function buildOpenAIEndpoint(baseURL: string): string {
	const normalized = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL
	if (normalized.endsWith('/v1')) {
		return `${normalized}/chat/completions`
	}

	return `${normalized}/v1/chat/completions`
}

function toOpenAIMessages(messages: Message[]): Array<Record<string, unknown>> {
	const output: Array<Record<string, unknown>> = []

	for (const message of messages) {
		if (message.role === 'tool') {
			output.push({
				role: 'tool',
				tool_call_id: message.toolCallId ?? '',
				content: message.content,
			})
			continue
		}

		if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
			output.push({
				role: 'assistant',
				content: message.content,
				tool_calls: message.toolCalls.map((toolCall) => ({
					id: toolCall.id,
					type: 'function',
					function: {
						name: toolCall.name,
						arguments: JSON.stringify(toolCall.arguments),
					},
				})),
			})
			continue
		}

		output.push({
			role: message.role,
			content: message.content,
		})
	}

	return output
}

function toOpenAITools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
	return tools.map((tool) => ({
		type: 'function',
		function: {
			name: tool.name,
			description: tool.description,
			parameters: {
				type: 'object',
				properties: tool.parameters,
			},
		},
	}))
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

function createErrorEvent(message: string, details?: unknown): StreamEvent {
	return {
		type: 'error',
		error: {
			code: 'PROVIDER_ERROR',
			message,
			details,
		},
	}
}

export class OpenAIAdapter implements ProviderAdapter {
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
		for (const message of messages) {
			if (message.role === 'tool' && !message.toolCallId) {
				yield createErrorEvent('Tool messages must include toolCallId')
				return
			}
		}

		const endpoint = buildOpenAIEndpoint(this.config.baseURL)
		const requestBody: Record<string, unknown> = {
			model: this.config.model,
			messages: toOpenAIMessages(messages),
			tools: toOpenAITools(tools),
			stream: true,
		}

		if (typeof options?.temperature === 'number') {
			requestBody.temperature = options.temperature
		}

		if (typeof options?.maxTokens === 'number') {
			requestBody.max_tokens = options.maxTokens
		}

		let response: Response
		try {
			response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${this.config.apiKey}`,
				},
				body: JSON.stringify(requestBody),
				signal: options?.signal,
			})
		} catch (error) {
			yield createErrorEvent('Network request to OpenAI failed', error)
			return
		}

		if (!response.ok) {
			const responseBody = await response.text().catch(() => '')
			yield createErrorEvent(`OpenAI request failed with status ${response.status}`, {
				status: response.status,
				body: responseBody,
			})
			return
		}

		if (!response.body) {
			yield createErrorEvent('OpenAI response body is empty')
			return
		}

		const pendingToolCalls = new Map<number, PendingToolCall>()
		let doneEmitted = false

		for await (const event of parseSseEvents(response.body)) {
			if (event.data === '[DONE]') {
				if (!doneEmitted) {
					yield {
						type: 'done',
						finishReason: 'stop',
					}
				}
				return
			}

			let chunk: OpenAIChunk
			try {
				chunk = JSON.parse(event.data) as OpenAIChunk
			} catch (error) {
				yield createErrorEvent('Failed to parse OpenAI SSE chunk', {
					chunk: event.data,
					error,
				})
				return
			}

			const choice = chunk.choices?.[0]
			if (!choice) {
				continue
			}

			if (typeof choice.delta?.content === 'string' && choice.delta.content.length > 0) {
				yield {
					type: 'text_delta',
					text: choice.delta.content,
				}
			}

			for (const deltaToolCall of choice.delta?.tool_calls ?? []) {
				const existing = pendingToolCalls.get(deltaToolCall.index) ?? {
					arguments: '',
					startEmitted: false,
				}

				if (deltaToolCall.id) {
					existing.id = deltaToolCall.id
				}

				if (typeof deltaToolCall.function?.name === 'string' && deltaToolCall.function.name.length > 0) {
					existing.name = deltaToolCall.function.name
				}

				if (
					!existing.startEmitted
					&& typeof existing.id === 'string'
					&& typeof existing.name === 'string'
				) {
					yield {
						type: 'tool_call_start',
						toolCall: {
							id: existing.id,
							name: existing.name,
						},
					}
					existing.startEmitted = true
				}

				if (typeof deltaToolCall.function?.arguments === 'string' && deltaToolCall.function.arguments.length > 0) {
					existing.arguments += deltaToolCall.function.arguments
					if (typeof existing.id === 'string') {
						yield {
							type: 'tool_call_delta',
							toolCallId: existing.id,
							argumentsDelta: deltaToolCall.function.arguments,
						}
					}
				}

				pendingToolCalls.set(deltaToolCall.index, existing)
			}

			if (choice.finish_reason === 'tool_calls') {
				for (const pendingToolCall of pendingToolCalls.values()) {
					if (!pendingToolCall.id || !pendingToolCall.name) {
						yield createErrorEvent('OpenAI tool call finished with incomplete metadata', pendingToolCall)
						continue
					}

					let parsedArguments: Record<string, unknown>
					try {
						parsedArguments = parseToolArguments(pendingToolCall.arguments)
					} catch (error) {
						yield createErrorEvent('Failed to parse OpenAI tool call arguments', {
							toolCallId: pendingToolCall.id,
							rawArguments: pendingToolCall.arguments,
							error,
						})
						continue
					}

					const completedToolCall: ToolCall = {
						id: pendingToolCall.id,
						name: pendingToolCall.name,
						arguments: parsedArguments,
					}

					yield {
						type: 'tool_call_complete',
						toolCall: completedToolCall,
					}
				}

				yield {
					type: 'done',
					finishReason: 'tool_calls',
				}
				doneEmitted = true
				return
			}

			if (choice.finish_reason === 'length' || choice.finish_reason === 'stop') {
				yield {
					type: 'done',
					finishReason: choice.finish_reason,
				}
				doneEmitted = true
				return
			}
		}
	}
}

export function createProviderError(message: string, details?: unknown): ElefantError {
	return {
		code: 'PROVIDER_ERROR',
		message,
		details,
	}
}
