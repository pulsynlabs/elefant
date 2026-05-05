import type { EmbeddingProviderConfig } from './embeddings/provider.ts';
import { createEmbeddingProvider } from './embeddings/provider.ts';
import { runPreparedBulkIndex, type BulkIndexWorkerMessage, type WorkerProgressMessage } from './indexer.ts';

type WorkerInboundMessage = BulkIndexWorkerMessage & {
  providerConfig: EmbeddingProviderConfig;
};

function post(message: WorkerProgressMessage): void {
  postMessage(message);
}

globalThis.onmessage = async (event: MessageEvent<WorkerInboundMessage>) => {
  const message = event.data;
  if (message.type !== 'bulk') return;

  const providerResult = createEmbeddingProvider(message.providerConfig);
  if (!providerResult.ok) {
    post({ type: 'error', message: providerResult.error.message });
    return;
  }

  const result = await runPreparedBulkIndex({
    projectPath: message.projectPath,
    projectId: message.projectId,
    provider: providerResult.data,
    documents: message.documents,
    maxConcurrentEmbeds: message.maxConcurrentEmbeds,
    emitProgress: (progress) => post({ type: 'progress', event: progress }),
  });

  await providerResult.data.dispose();
  post({ type: 'done', summary: result });
};
