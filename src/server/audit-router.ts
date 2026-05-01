// Audit failure router
//
// Maps a parsed AuditReport to a routing decision the orchestrator acts on.
// Pure logic — no DB or hook side effects — so it's trivially unit-testable.

import {
	deriveRecommendation,
	type AuditReport,
	type AuditRecommendation,
	type VerificationResult,
} from '../tools/workflow/verifier-output.ts';

export type AuditSeverity = 'minor' | 'moderate' | 'major';

export interface AuditRoutingDecision {
	severity: AuditSeverity;
	action: 'auto-fix' | 'amend-spec' | 'stop-user' | 'accept-eligible';
	failedVcs: string[];
	message: string;
}

/**
 * Classify the severity of a failing audit report. Mirrors the logic of
 * `deriveRecommendation` but returns the human-facing severity name used in
 * routing decisions and surfaced to the user.
 *
 * Caller is responsible for first checking whether `results` contains any
 * non-pass entries; this function assumes failure exists.
 */
export function classifyAuditFailures(report: AuditReport): AuditSeverity {
	const failures = report.results.filter((r) => r.status === 'fail');
	const mustFails = failures.filter((r) => r.severity === 'must');

	if (mustFails.length >= 3) return 'major';
	if (mustFails.length >= 1) return 'moderate';
	return 'minor';
}

function failedVcIds(results: readonly VerificationResult[]): string[] {
	return results
		.filter((r) => r.status === 'fail' || r.status === 'partial')
		.map((r) => r.vcId);
}

/**
 * Convert an audit report into the orchestrator's next action. The mapping:
 *   - accept       → no failures, no partials → accept-eligible
 *   - minor-fix    → only non-must failures → executor-medium auto-fix
 *   - moderate-fix → 1-2 must failures or any partial → planner amends spec
 *   - major-stop   → 3+ must failures → halt and request user decision
 */
export function routeAuditFailure(report: AuditReport): AuditRoutingDecision {
	const recommendation: AuditRecommendation = deriveRecommendation(report.results);
	const failed = failedVcIds(report.results);

	if (recommendation === 'accept') {
		return {
			severity: 'minor',
			action: 'accept-eligible',
			failedVcs: [],
			message: 'All validation contracts pass — workflow ready for acceptance.',
		};
	}

	if (recommendation === 'minor-fix') {
		return {
			severity: 'minor',
			action: 'auto-fix',
			failedVcs: failed,
			message: `Minor failures detected — dispatching executor to patch: ${failed.join(', ')}`,
		};
	}

	if (recommendation === 'moderate-fix') {
		return {
			severity: 'moderate',
			action: 'amend-spec',
			failedVcs: failed,
			message: `Moderate failures detected — dispatching planner to amend spec: ${failed.join(', ')}`,
		};
	}

	return {
		severity: 'major',
		action: 'stop-user',
		failedVcs: failed,
		message: `Major failures detected — halting and requesting user decision: ${failed.join(', ')}`,
	};
}
