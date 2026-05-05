export type IndexProgressPhase = 'walking' | 'chunking' | 'embedding' | 'writing' | 'done' | 'error';

export interface IndexProgressEvent {
  projectId: string;
  phase: IndexProgressPhase;
  current: number;
  total: number;
  file?: string;
  error?: string;
}

/** Simple in-process pub/sub for index progress consumers. */
export class ProgressEmitter {
  private readonly handlers = new Set<(event: IndexProgressEvent) => void>();

  subscribe(handler: (event: IndexProgressEvent) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  emit(event: IndexProgressEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  toSSEData(event: IndexProgressEvent): string {
    return `data: ${JSON.stringify(event)}\n\n`;
  }
}
