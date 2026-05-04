import type { TerminalRenderer } from './renderer.js';

type ClientMessage =
	| { type: 'input'; data: string }
	| { type: 'resize'; cols: number; rows: number }
	| { type: 'close' };

type ServerMessage =
	| { type: 'output'; data: string }
	| { type: 'exit'; code: number }
	| { type: 'error'; message: string };

export class PtyBridge {
	private ws: WebSocket | null = null;
	private renderer: TerminalRenderer | null = null;
	private reconnectAttempts = 0;
	private readonly maxReconnects = 3;
	private intentionalClose = false;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private unsubscribeData: (() => void) | null = null;
	private lastKnownCols = 80;
	private lastKnownRows = 24;

	constructor(
		private projectId: string,
		private sessionId: string,
		private daemonBaseUrl: string
	) {}

	connect(renderer: TerminalRenderer): void {
		this.renderer = renderer;
		this.intentionalClose = false;

		this.unsubscribeData?.();
		this.unsubscribeData = renderer.onData((data) => {
			this.sendMessage({ type: 'input', data });
		});

		this.openSocket();
	}

	sendResize(cols: number, rows: number): void {
		const normalizedCols = Number.isFinite(cols) ? Math.max(2, Math.floor(cols)) : 80;
		const normalizedRows = Number.isFinite(rows) ? Math.max(2, Math.floor(rows)) : 24;

		this.lastKnownCols = normalizedCols;
		this.lastKnownRows = normalizedRows;

		this.sendMessage({ type: 'resize', cols: normalizedCols, rows: normalizedRows });
	}

	disconnect(): void {
		this.intentionalClose = true;
		this.clearReconnectTimer();

		this.unsubscribeData?.();
		this.unsubscribeData = null;

		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.sendMessage({ type: 'close' });
		}

		this.ws?.close();
		this.ws = null;
		this.renderer = null;
	}

	private openSocket(): void {
		if (this.intentionalClose || !this.renderer) return;

		this.ws?.close();
		this.ws = null;

		const wsUrl = this.getWebSocketUrl();
		const socket = new WebSocket(wsUrl);
		this.ws = socket;

		socket.onopen = () => {
			if (this.ws !== socket) return;
			this.reconnectAttempts = 0;
			this.sendMessage({
				type: 'resize',
				cols: this.lastKnownCols,
				rows: this.lastKnownRows,
			});
		};

		socket.onmessage = (event) => {
			if (this.ws !== socket || !this.renderer) return;

			let parsed: ServerMessage;
			try {
				parsed = JSON.parse(String(event.data)) as ServerMessage;
			} catch {
				this.renderer.write(`\r\n[PTY protocol error: invalid message]\r\n`);
				return;
			}

			switch (parsed.type) {
				case 'output':
					this.renderer.write(parsed.data);
					break;
				case 'exit':
					this.renderer.write(`\r\n[Process exited ${parsed.code}]\r\n`);
					break;
				case 'error':
					this.renderer.write(`\r\n[PTY error: ${parsed.message}]\r\n`);
					break;
			}
		};

		socket.onclose = () => {
			if (this.ws === socket) {
				this.ws = null;
			}

			if (this.intentionalClose) return;
			this.scheduleReconnect();
		};
	}

	private scheduleReconnect(): void {
		if (!this.renderer) return;
		if (this.reconnectAttempts >= this.maxReconnects) {
			this.renderer.write('\r\n[Connection lost. Reload to reconnect.]\r\n');
			return;
		}

		const delay = 100 * 2 ** this.reconnectAttempts;
		this.reconnectAttempts += 1;

		this.clearReconnectTimer();
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.openSocket();
		}, delay);
	}

	private sendMessage(message: ClientMessage): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
		this.ws.send(JSON.stringify(message));
	}

	private clearReconnectTimer(): void {
		if (!this.reconnectTimer) return;
		clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;
	}

	private getWebSocketUrl(): string {
		const httpUrl = new URL(
			`/api/projects/${encodeURIComponent(this.projectId)}/sessions/${encodeURIComponent(this.sessionId)}/pty`,
			this.daemonBaseUrl
		);

		httpUrl.protocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:';
		return httpUrl.toString();
	}
}
