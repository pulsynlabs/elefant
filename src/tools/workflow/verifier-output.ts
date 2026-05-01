// Verifier output schema
//
// Strict shape for the JSON the verifier agent emits inside its
// <verification> envelope block. Consumed by `routeAuditFailure` (Task 10.3)
// and stored in spec_chronicle_entries with kind: "audit_report".
//
// The schema rejects pass-without-evidence and counts mismatches so the
// orchestrator can rely on the parse step as a gate, not a hint.

import { z } from 'zod';

export const VcStatusSchema = z.enum(['pass', 'fail', 'partial', 'skipped']);
export type VcStatus = z.infer<typeof VcStatusSchema>;

export const VcSeveritySchema = z.enum(['must', 'should', 'may']);
export type VcSeverity = z.infer<typeof VcSeveritySchema>;

export const VerificationResultSchema = z
	.object({
		vcId: z.string().min(1),
		status: VcStatusSchema,
		evidence: z.string().min(1),
		recommendation: z.string().optional(),
		severity: VcSeveritySchema.optional(),
	})
	.refine((entry) => !(entry.status === 'pass' && entry.evidence.trim().length === 0), {
		message: 'pass results require non-empty evidence',
		path: ['evidence'],
	});

export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export const AuditRecommendationSchema = z.enum([
	'accept',
	'minor-fix',
	'moderate-fix',
	'major-stop',
]);
export type AuditRecommendation = z.infer<typeof AuditRecommendationSchema>;

export const AuditReportSchema = z
	.object({
		workflowId: z.string().min(1),
		auditedAt: z.string().min(1),
		results: z.array(VerificationResultSchema),
		summary: z.object({
			total: z.number().int().nonnegative(),
			pass: z.number().int().nonnegative(),
			fail: z.number().int().nonnegative(),
			partial: z.number().int().nonnegative(),
		}),
		recommendation: AuditRecommendationSchema,
	})
	.refine(
		(report) => report.results.length === report.summary.total,
		{ message: 'summary.total must match results.length', path: ['summary', 'total'] },
	);

export type AuditReport = z.infer<typeof AuditReportSchema>;

/**
 * Re-derive the recommendation from a result list, ignoring whatever the
 * verifier emitted. Used by `routeAuditFailure` so the orchestrator never
 * relies on the verifier to compute its own routing decision.
 */
export function deriveRecommendation(
	results: readonly VerificationResult[],
): AuditRecommendation {
	if (results.length === 0) return 'accept';

	const failures = results.filter((r) => r.status === 'fail');
	const partials = results.filter((r) => r.status === 'partial');

	const mustFails = failures.filter((r) => r.severity === 'must');
	if (mustFails.length >= 3) return 'major-stop';
	if (mustFails.length >= 1) return 'moderate-fix';
	if (failures.length > 0) return 'minor-fix';
	if (partials.length > 0) return 'moderate-fix';
	return 'accept';
}
