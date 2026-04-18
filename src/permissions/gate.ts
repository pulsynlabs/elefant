import { insertEvent } from '../db/repo/events.ts';
import type { DaemonContext } from '../daemon/context.ts';
import { emit } from '../hooks/emit.ts';
import type { ElefantWsServer } from '../transport/ws-server.ts';
import type { ElefantError } from '../types/errors.ts';
import { err, ok, type Result } from '../types/result.ts';
import { classify, DEFAULT_CLASSIFIER_RULES } from './classifier.ts';
import type { ClassifierRule, Decision } from './types.ts';

export interface PermissionGateOptions {
	timeoutMs?: number;
	rules?: ClassifierRule[];
}

interface ApprovalRequest {
	requestId: string;
	tool: string;
	args: Record<string, unknown>;
	risk: 'high';
	conversationId: string;
	timeoutMs: number;
}

interface ApprovalResponse {
	approved: boolean;
	reason?: string;
}

export class PermissionGate {
	private readonly timeoutMs: number;
	private readonly rules: ClassifierRule[];
	private readonly fallbackSessionId = 'system';

	constructor(
		private readonly ctx: DaemonContext,
		private readonly ws: ElefantWsServer | null,
		options: PermissionGateOptions = {},
	) {
		this.timeoutMs = options.timeoutMs ?? 5 * 60_000;
		this.rules = options.rules ?? DEFAULT_CLASSIFIER_RULES;
	}

	async check(
		tool: string,
		args: Record<string, unknown>,
		conversationId: string,
	): Promise<Result<Decision, ElefantError>> {
		try {
			let risk = classify(tool, args, this.rules);

			const hookCtx = await emit(this.ctx.hooks, 'permission:ask', {
				tool,
				args,
				conversationId,
				risk,
			});
			risk = hookCtx.risk;

			let decision: Decision;

			if (risk === 'low') {
				decision = {
					approved: true,
					reason: 'auto-approved (low risk)',
					risk,
				};
			} else if (risk === 'medium') {
				console.log(
					`[elefant] Medium-risk tool call: ${tool} (auto-approved, logged)`,
				);
				decision = {
					approved: true,
					reason: 'auto-approved (medium risk, logged)',
					risk,
				};
			} else {
				decision = await this.resolveHighRiskDecision(tool, args, conversationId);
			}

			this.persistDecision(tool, args, conversationId, decision);

			if (decision.approved) {
				await emit(this.ctx.hooks, 'tool:allow', { tool, conversationId });
			} else {
				await emit(this.ctx.hooks, 'tool:block', {
					tool,
					reason: decision.reason,
					conversationId,
				});
			}

			return ok(decision);
		} catch (error) {
			return err({
				code: 'TOOL_EXECUTION_FAILED',
				message: 'Permission gate check failed',
				details: error,
			});
		}
	}

	private async resolveHighRiskDecision(
		tool: string,
		args: Record<string, unknown>,
		conversationId: string,
	): Promise<Decision> {
		if (!this.ws) {
			return {
				approved: false,
				reason: 'high-risk tool requires approval (no WebSocket available)',
				risk: 'high',
			};
		}

		const payload: ApprovalRequest = {
			requestId: crypto.randomUUID(),
			tool,
			args,
			risk: 'high',
			conversationId,
			timeoutMs: this.timeoutMs,
		};

		const result = (await this.ws.requestApproval(
			payload,
			this.timeoutMs,
		)) as ApprovalResponse;

		return {
			approved: result.approved,
			reason:
				result.reason ?? (result.approved ? 'user approved' : 'user denied'),
			risk: 'high',
		};
	}

	private persistDecision(
		tool: string,
		args: Record<string, unknown>,
		conversationId: string,
		decision: Decision,
	): void {
		try {
			const maybeSession = this.ctx.db.db
				.query(
					'SELECT id FROM sessions WHERE id IN (SELECT session_id FROM events WHERE data LIKE ? LIMIT 1)',
				)
				.get(`%"conversationId":"${conversationId}"%`) as
				| { id: string }
				| null;

			const sessionId = maybeSession?.id ?? this.fallbackSessionId;
			if (sessionId === this.fallbackSessionId) {
				return;
			}

			insertEvent(this.ctx.db, {
				id: crypto.randomUUID(),
				session_id: sessionId,
				type: 'permission',
				data: JSON.stringify({
					tool,
					args,
					risk: decision.risk,
					approved: decision.approved,
					reason: decision.reason,
					conversationId,
				}),
			});
		} catch {
			// non-fatal persistence path
		}
	}
}
