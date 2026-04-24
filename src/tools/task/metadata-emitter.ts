export interface ToolCallMetadataPayload {
	toolCallId: string;
	runId: string;
	parentRunId?: string;
	agentType: string;
	title: string;
	conversationId?: string;
}

export type MetadataEmitter = (payload: ToolCallMetadataPayload) => void;

export function createMetadataEmitter(
	conversationId: string,
	emit: MetadataEmitter,
): MetadataEmitter {
	return (payload: ToolCallMetadataPayload): void => {
		emit({
			...payload,
			conversationId,
		});
	};
}
