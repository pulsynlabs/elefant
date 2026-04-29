import { insertEvent } from '../db/repo/events.ts';
import type { DaemonContext } from '../daemon/context.ts';
import { emit } from '../hooks/emit.ts';
import type { HookContextMap } from '../hooks/types.ts';
import type { ElefantWsServer } from '../transport/ws-server.ts';
import type { ElefantError } from '../types/errors.ts';
import { err, ok, type Result } from '../types/result.ts';
import { classifyPermission, DEFAULT_CLASSIFIER_RULES } from './classifier.ts';
import { statusFromApproval } from './types.ts';
import type {
	ClassifierRule,
	Decision,
	PermissionDecisionStatus,
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
	risk: Risk;
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

interface PermissionAskedEvent {
	requestId: string;
	tool: string;
	classification: Risk;
	projectId?: string;
	sessionId?: string;
	agent?: string;
	ts: number;
}

interface PermissionResolvedEvent {
	requestId: string;
	status: PermissionDecisionStatus;
	source: 'hook' | 'user' | 'default';
	reason?: string;
	durationMs: number;
	ts: number;
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
			const startedAt = Date.now();
			const requestId = crypto.randomUUID();
			const classification = classifyPermission(tool, args, this.rules, {
				agentType: context.agent,
			});
			let risk: Risk = classification.decision === 'risk' ? classification.risk : 'high';

			this.publishPermissionAskedEvent(context, {
				requestId,
				tool,
				classification: risk,
				projectId: context.projectId,
				sessionId: context.sessionId,
				agent: context.agent,
				ts: startedAt,
			});

			if (classification.decision === 'deny') {
				const decision: Decision = {
					approved: false,
					status: 'deny',
					reason: classification.reason,
					risk,
					source: 'default',
				};

				this.publishPermissionResolvedEvent(context, {
					requestId,
					status: 'deny',
					source: 'default',
					reason: classification.reason,
					durationMs: Date.now() - startedAt,
					ts: Date.now(),
				});
				this.persistDecision(tool, args, conversationId, decision);
				await emit(this.ctx.hooks, 'tool:block', {
					tool,
					reason: classification.reason,
					conversationId,
				});
				return ok(decision);
			}

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
					status: 'deny',
					reason: hookCtx.reason ?? 'denied by permission hook',
					risk,
					source: 'hook',
				};
			} else if (hookStatus === 'allow') {
				decision = {
					approved: true,
					status: 'allow',
					reason: hookCtx.reason ?? 'approved by permission hook',
					risk,
					source: 'hook',
				};
			} else if (hookStatus === 'ask') {
				decision = await this.resolveUserApproval(
					tool,
					args,
					conversationId,
					requestId,
					risk,
				);
			} else if (risk === 'low') {
				decision = {
					approved: true,
					status: 'allow',
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
					status: 'allow',
					reason: 'auto-approved (medium risk, logged)',
					risk,
					source: 'default',
				};
			} else {
				decision = await this.resolveUserApproval(
					tool,
					args,
					conversationId,
					requestId,
					risk,
				);
			}

			const resolvedStatus = decision.status;
			this.publishPermissionResolvedEvent(context, {
				requestId,
				status: resolvedStatus,
				source: decision.source,
				reason: decision.reason,
				durationMs: Date.now() - startedAt,
				ts: Date.now(),
			});

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

	private async resolveUserApproval(
		tool: string,
		args: Record<string, unknown>,
		conversationId: string,
		requestId: string,
		risk: Risk,
	): Promise<Decision> {
		if (!this.ws) {
			return {
				approved: false,
				status: 'deny',
				reason: `${risk === 'high' ? 'high-risk' : 'ask'} tool requires approval (no WebSocket available)`,
				risk,
				source: 'default',
			};
		}

		const payload: ApprovalRequest = {
			requestId,
			tool,
			args,
			risk,
			conversationId,
			timeoutMs: this.timeoutMs,
		};

		const result = (await this.ws.requestApproval(
			payload,
			this.timeoutMs,
		)) as ApprovalResponse;

		return {
			approved: result.approved,
			status: statusFromApproval(result.approved),
			reason:
				result.reason ?? (result.approved ? 'user approved' : 'user denied'),
			risk,
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

				if (typeof result === 'object' && !('cancel' in result)) {
					const partial = result as Partial<HookContextMap['permission:ask']>;
					const statusAlreadySet = context.status !== undefined;
					const incomingStatus = partial.status;
					const shouldIgnoreIncomingStatus =
						statusAlreadySet && incomingStatus !== undefined;

					context = {
						...context,
						...partial,
						status: context.status ?? partial.status,
						reason: shouldIgnoreIncomingStatus
							? context.reason
							: (partial.reason ?? context.reason),
					};
				}
			} catch (error) {
				console.error('[elefant] Hook handler error (permission:ask):', error);
			}
		}

		return context;
	}

	private publishPermissionAskedEvent(
		context: PermissionCheckContext,
		event: PermissionAskedEvent,
	): void {
		this.publishPermissionEvent(
			context,
			'permission.asked',
			event,
		);
	}

	private publishPermissionResolvedEvent(
		context: PermissionCheckContext,
		event: PermissionResolvedEvent,
	): void {
		this.publishPermissionEvent(
			context,
			'permission.resolved',
			event,
		);
	}

	private publishPermissionEvent(
		context: PermissionCheckContext,
		eventType: 'permission.asked' | 'permission.resolved',
		data: PermissionAskedEvent | PermissionResolvedEvent,
	): void {
		if (!context.projectId || !context.sessionId) {
			return;
		}

		const sse = this.ctx.sse as unknown as {
			publish?: (
				projectId: string,
				sessionId: string,
				eventType: string,
				data: unknown,
			) => void;
		};

		if (typeof sse.publish !== 'function') {
			return;
		}

		sse.publish(context.projectId, context.sessionId, eventType, data);
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
					status: decision.status,
					reason: decision.reason,
					conversationId,
				}),
			});
		} catch {
			// non-fatal persistence path
		}
	}
}
