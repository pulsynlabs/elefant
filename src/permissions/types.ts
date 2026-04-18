export type Risk = 'low' | 'medium' | 'high';

export interface Decision {
	approved: boolean;
	reason: string;
	risk: Risk;
}

export interface ClassifierRule {
	tool: string | RegExp;
	argsPattern?: (args: Record<string, unknown>) => boolean;
	risk: Risk;
}
