export type Risk = 'low' | 'medium' | 'high';

export type PermissionDecisionStatus = 'allow' | 'ask' | 'deny';

export type PermissionDecisionSource = 'hook' | 'user' | 'default';

export interface Decision {
	approved: boolean;
	reason: string;
	risk: Risk;
	source: PermissionDecisionSource;
}

export interface ClassifierRule {
	tool: string | RegExp;
	argsPattern?: (args: Record<string, unknown>) => boolean;
	risk: Risk;
}
