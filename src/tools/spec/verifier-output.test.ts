import { describe, expect, test } from 'bun:test';

import {
	AuditReportSchema,
	deriveRecommendation,
	VerificationResultSchema,
} from './verifier-output.ts';

const passResult = {
	vcId: 'VC1.A',
	status: 'pass' as const,
	evidence: 'bun test src/auth/ — 12 tests passed',
};

const failResult = {
	vcId: 'VC1.B',
	status: 'fail' as const,
	evidence: 'bun test reports 1 failure in src/auth/middleware.ts:42',
	severity: 'must' as const,
};

describe('VerificationResultSchema', () => {
	test('accepts a well-formed pass result', () => {
		expect(() => VerificationResultSchema.parse(passResult)).not.toThrow();
	});

	test('rejects pass with empty evidence string', () => {
		expect(() =>
			VerificationResultSchema.parse({ vcId: 'VC1.A', status: 'pass', evidence: '' }),
		).toThrow();
	});

	test('rejects entries missing vcId', () => {
		expect(() =>
			VerificationResultSchema.parse({ status: 'fail', evidence: 'x' }),
		).toThrow();
	});
});

describe('AuditReportSchema', () => {
	test('parses a well-formed audit report', () => {
		const report = AuditReportSchema.parse({
			workflowId: 'spec-mode',
			auditedAt: '2026-04-29T12:00:00Z',
			results: [passResult, failResult],
			summary: { total: 2, pass: 1, fail: 1, partial: 0 },
			recommendation: 'moderate-fix',
		});
		expect(report.results).toHaveLength(2);
		expect(report.recommendation).toBe('moderate-fix');
	});

	test('rejects when summary.total disagrees with results length', () => {
		expect(() =>
			AuditReportSchema.parse({
				workflowId: 'spec-mode',
				auditedAt: '2026-04-29T12:00:00Z',
				results: [passResult],
				summary: { total: 99, pass: 1, fail: 0, partial: 0 },
				recommendation: 'accept',
			}),
		).toThrow();
	});

	test('rejects an unknown recommendation', () => {
		expect(() =>
			AuditReportSchema.parse({
				workflowId: 'spec-mode',
				auditedAt: '2026-04-29T12:00:00Z',
				results: [],
				summary: { total: 0, pass: 0, fail: 0, partial: 0 },
				recommendation: 'definitely-not-a-real-status',
			}),
		).toThrow();
	});
});

describe('deriveRecommendation', () => {
	test('returns accept for empty results', () => {
		expect(deriveRecommendation([])).toBe('accept');
	});

	test('returns accept when every result passes', () => {
		expect(deriveRecommendation([passResult])).toBe('accept');
	});

	test('returns minor-fix when only non-must failures present', () => {
		expect(
			deriveRecommendation([{ ...failResult, severity: 'should' }]),
		).toBe('minor-fix');
	});

	test('returns moderate-fix on a single must failure', () => {
		expect(deriveRecommendation([failResult])).toBe('moderate-fix');
	});

	test('returns major-stop when 3+ must failures present', () => {
		const fails = [failResult, failResult, failResult];
		expect(deriveRecommendation(fails)).toBe('major-stop');
	});

	test('returns moderate-fix when only partial results present', () => {
		expect(
			deriveRecommendation([
				{ ...passResult, status: 'partial', evidence: 'x' },
			]),
		).toBe('moderate-fix');
	});
});
