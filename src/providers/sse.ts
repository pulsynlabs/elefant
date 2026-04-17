export interface SseEvent {
	event?: string
	data: string
}

export async function* parseSseEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
	const reader = stream.getReader()
	const decoder = new TextDecoder()
	let buffer = ''
	let currentEventName: string | undefined
	let currentDataLines: string[] = []

	const flushEvent = (): SseEvent | null => {
		if (currentDataLines.length === 0) {
			currentEventName = undefined
			return null
		}

		const event: SseEvent = {
			event: currentEventName,
			data: currentDataLines.join('\n'),
		}

		currentEventName = undefined
		currentDataLines = []
		return event
	}

	const processLine = (line: string): SseEvent | null => {
		if (line === '') {
			return flushEvent()
		}

		if (line.startsWith(':')) {
			return null
		}

		const separatorIndex = line.indexOf(':')
		const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex)
		const value = separatorIndex === -1 ? '' : line.slice(separatorIndex + 1).trimStart()

		if (field === 'event') {
			currentEventName = value
			return null
		}

		if (field === 'data') {
			currentDataLines.push(value)
		}

		return null
	}

	while (true) {
		const { done, value } = await reader.read()
		if (done) {
			break
		}

		buffer += decoder.decode(value, { stream: true })

		while (true) {
			const newlineIndex = buffer.indexOf('\n')
			if (newlineIndex === -1) {
				break
			}

			const rawLine = buffer.slice(0, newlineIndex)
			buffer = buffer.slice(newlineIndex + 1)
			const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
			const event = processLine(line)
			if (event) {
				yield event
			}
		}
	}

	buffer += decoder.decode()

	if (buffer.length > 0) {
		const line = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer
		const event = processLine(line)
		if (event) {
			yield event
		}
	}

	const trailingEvent = flushEvent()
	if (trailingEvent) {
		yield trailingEvent
	}
}
