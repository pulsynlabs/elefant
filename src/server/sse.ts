export function formatSSEEvent(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export function formatSSEKeepalive(): string {
	return ': keepalive\n\n'
}
