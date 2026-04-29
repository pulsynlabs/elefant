import type { SpecWorkflowPhase } from './schema.ts';

export class SpecModeNotConfiguredError extends Error {
  readonly code = 'SPEC_MODE_NOT_CONFIGURED' as const;

  constructor(message: string) {
    super(message);
    this.name = 'SpecModeNotConfiguredError';
  }
}

export class WorkflowExistsError extends Error {
  readonly code = 'WORKFLOW_EXISTS' as const;
  readonly projectId: string;
  readonly workflowId: string;

  constructor(input: { code: 'WORKFLOW_EXISTS'; projectId: string; workflowId: string }) {
    super(`Workflow ${input.workflowId} already exists for project ${input.projectId}`);
    this.name = 'WorkflowExistsError';
    this.projectId = input.projectId;
    this.workflowId = input.workflowId;
  }
}

export class WorkflowNotFoundError extends Error {
  readonly code = 'WORKFLOW_NOT_FOUND' as const;
  readonly projectId: string;
  readonly workflowId: string;

  constructor(input: { code: 'WORKFLOW_NOT_FOUND'; projectId: string; workflowId: string }) {
    super(`Workflow ${input.workflowId} was not found for project ${input.projectId}`);
    this.name = 'WorkflowNotFoundError';
    this.projectId = input.projectId;
    this.workflowId = input.workflowId;
  }
}

export class InvalidTransitionError extends Error {
  readonly code = 'INVALID_TRANSITION' as const;
  readonly from: SpecWorkflowPhase;
  readonly to: SpecWorkflowPhase;
  readonly allowed: readonly SpecWorkflowPhase[];

  constructor(input: {
    code: 'INVALID_TRANSITION';
    from: SpecWorkflowPhase;
    to: SpecWorkflowPhase;
    allowed: readonly SpecWorkflowPhase[];
  }) {
    super(
      `Invalid spec workflow transition from ${input.from} to ${input.to}. Allowed: ${input.allowed.join(', ')}`,
    );
    this.name = 'InvalidTransitionError';
    this.from = input.from;
    this.to = input.to;
    this.allowed = input.allowed;
  }
}

export class SpecLockedError extends Error {
  readonly code = 'SPEC_LOCKED' as const;
  readonly workflowId: string;
  readonly attempted: string;
  readonly projectId?: string;

  constructor(input: { code?: 'SPEC_LOCKED'; workflowId: string; attempted: string; projectId?: string }) {
    super(`Spec is locked for workflow ${input.workflowId}; attempted write to ${input.attempted}`);
    this.name = 'SpecLockedError';
    this.workflowId = input.workflowId;
    this.attempted = input.attempted;
    this.projectId = input.projectId;
  }
}
