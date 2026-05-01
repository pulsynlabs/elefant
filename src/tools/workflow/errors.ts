export const SpecToolErrorCode = {
	SPEC_LOCKED: 'SPEC_LOCKED',
	INVALID_PHASE: 'INVALID_PHASE',
	INVALID_TRANSITION: 'INVALID_TRANSITION',
	WORKFLOW_NOT_FOUND: 'WORKFLOW_NOT_FOUND',
	IDEMPOTENT_REPLAY: 'IDEMPOTENT_REPLAY',
	VALIDATION_FAILED: 'VALIDATION_FAILED',
	VALIDATION_CONTRACT_INCOMPLETE: 'VALIDATION_CONTRACT_INCOMPLETE',
} as const;

export type SpecToolErrorCode = typeof SpecToolErrorCode[keyof typeof SpecToolErrorCode];

export class SpecToolError extends Error {
	public constructor(
		public readonly code: SpecToolErrorCode,
		message: string,
		public readonly details?: unknown,
	) {
		super(message);
		this.name = 'SpecToolError';
	}

	toJSON(): { name: string; code: SpecToolErrorCode; message: string; details?: unknown } {
		return {
			name: this.name,
			code: this.code,
			message: this.message,
			...(this.details === undefined ? {} : { details: this.details }),
		};
	}
}

export function isSpecToolError(value: unknown): value is SpecToolError {
	return value instanceof SpecToolError;
}
