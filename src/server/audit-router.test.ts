import { describe, expect, test } from 'bun:test';

import type { AuditReport, VerificationResult } from '../tools/spec/verifier-output.ts';
import { classifyAuditFailures, routeAuditFailure } from './audit-router.ts';

function makeReport(results: VerificationResult[]): AuditReport {
	return {
		workflowId: 'spec-mode',
		auditedAt: '2026-04-29T12:00:00Z',
		results,
		summary: {
			total: results.length,
			pass: results.filter((r) => r.status === 'pass').length,
			fail: results.filter((r) => r.status === 'fail').length,
			partial: results.filter((r) => r.status === 'partial').length,
		},
		recommendation: 'accept',
	};
}

const passing: VerificationResult = {
	vcId: 'VC1.A',
	status: 'pass',
	evidence: 'tests pass',
};

const mustFail: VerificationResult = {
	vcId: 'VC1.B',
	status: 'fail',
	evidence: 'failing assertion',
	severity: 'must',
};

const shouldFail: VerificationResult = {
	vcId: 'VC2.A',
	status: 'fail',
	evidence: 'lint fail',
	severity: 'should',
};

describe('classifyAuditFailures', () => {
	test('returns minor when no must failures present', () => {
		const report = makeReport([shouldFail]);
		expect(classifyAuditFailures(report)).toBe('minor');
	});

	test('returns moderate on 1 must failure', () => {
		expect(classifyAuditFailures(makeReport([mustFail]))).toBe('moderate');
	});

	test('returns moderate on 2 must failures', () => {
		expect(classifyAuditFailures(makeReport([mustFail, mustFail]))).toBe('moderate');
	});

	test('returns major on 3+ must failures', () => {
		const fails = [mustFail, mustFail, mustFail];
		expect(classifyAuditFailures(makeReport(fails))).toBe('major');
	});
});

describe('routeAuditFailure', () => {
	test('accept-eligible when every result passes', () => {
		const decision = routeAuditFailure(makeReport([passing]));
		expect(decision.action).toBe('accept-eligible');
		expect(decision.failedVcs).toEqual([]);
	});

	test('auto-fix for minor (non-must) failures', () => {
		const decision = routeAuditFailure(makeReport([shouldFail]));
		expect(decision.action).toBe('auto-fix');
		expect(decision.severity).toBe('minor');
		expect(decision.failedVcs).toEqual(['VC2.A']);
	});

	test('amend-spec for 1 must failure', () => {
		const decision = routeAuditFailure(makeReport([mustFail]));
		expect(decision.action).toBe('amend-spec');
		expect(decision.severity).toBe('moderate');
		expect(decision.failedVcs).toEqual(['VC1.B']);
	});

	test('stop-user for 3+ must failures', () => {
		const decision = routeAuditFailure(makeReport([mustFail, mustFail, mustFail]));
		expect(decision.action).toBe('stop-user');
		expect(decision.severity).toBe('major');
	});

	test('amend-spec when only partial results present', () => {
		const partial: VerificationResult = {
			vcId: 'VC3.A',
			status: 'partial',
			evidence: 'partial coverage',
		};
		const decision = routeAuditFailure(makeReport([partial]));
		expect(decision.action).toBe('amend-spec');
		expect(decision.failedVcs).toEqual(['VC3.A']);
	});
});
