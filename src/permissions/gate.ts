import { insertEvent } from '../db/repo/events.ts';
import type { DaemonContext } from '../daemon/context.ts';
import { emit } from '../hooks/emit.ts';
import type { HookContextMap } from '../hooks/types.ts';
import type { ElefantWsServer } from '../transport/ws-server.ts';
import type { ElefantError } from '../types/errors.ts';
import { err, ok, type Result } from '../types/result.ts';
import { classify, DEFAULT_CLASSIFIER_RULES } from './classifier.ts';
import type {
	ClassifierRule,
	Decision,
	Risk,
} from './types.ts';

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

export interface PermissionCheckContext {
	sessionId?: string;
	projectId?: string;
	agent?: string;
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
		context: PermissionCheckContext = {},
	): Promise<Result<Decision, ElefantError>> {
		try {
			let risk = classify(tool, args, this.rules);

			const hookCtx = await this.emitPermissionAskHooks({
				tool,
				args,
				conversationId,
				sessionId: context.sessionId,
				projectId: context.projectId,
				agent: context.agent,
				risk,
			});
			risk = hookCtx.classification ?? hookCtx.risk;
			const hookStatus = hookCtx.status;

			let decision: Decision;

			if (hookStatus === 'deny') {
				decision = {
					approved: false,
					reason: hookCtx.reason ?? 'denied by permission hook',
					risk,
					source: 'hook',
				};
			} else if (hookStatus === 'allow') {
				decision = {
					approved: true,
					reason: hookCtx.reason ?? 'approved by permission hook',
					risk,
					source: 'hook',
				};
			} else if (risk === 'low') {
				decision = {
					approved: true,
					reason: 'auto-approved (low risk)',
					risk,
					source: 'default',
				};
			} else if (risk === 'medium') {
				console.log(
					`[elefant] Medium-risk tool call: ${tool} (auto-approved, logged)`,
				);
				decision = {
					approved: true,
					reason: 'auto-approved (medium risk, logged)',
					risk,
					source: 'default',
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
				source: 'default',
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
			source: 'user',
		};
	}

	private async emitPermissionAskHooks(
		initialContext: HookContextMap['permission:ask'],
	): Promise<HookContextMap['permission:ask']> {
		let context = {
			...initialContext,
		} as HookContextMap['permission:ask'];

		const handlers = this.ctx.hooks.getHandlers('permission:ask');
		for (const handler of handlers) {
			try {
				const result = await handler(context);
				if (result == null) {
					continue;
				}

				if (
					typeof result === 'object' &&
					'cancel' in result &&
					result.cancel === true
				) {
					break;
				}

				if (typeof result === 'object') {
					const statusAlreadySet = context.status !== undefined;
					const incomingStatus = result.status;
					const shouldIgnoreIncomingStatus =
						statusAlreadySet && incomingStatus !== undefined;

					context = {
						...context,
						...result,
						status: context.status ?? result.status,
						reason: shouldIgnoreIncomingStatus
							? context.reason
							: (result.reason ?? context.reason),
					};
				}
			} catch (error) {
				console.error('[elefant] Hook handler error (permission:ask):', error);
			}
		}

		return context;
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
