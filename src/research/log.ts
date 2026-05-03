/**
 * Research Base logging utilities.
 *
 * All research modules log under the `research:` namespace for consistent
 * observability. The logger respects the DEBUG environment variable to
 * enable debug-level output when `DEBUG` includes 'research'.
 */

function isDebugEnabled(): boolean {
  return Bun.env.DEBUG?.includes('research') ?? false;
}

export interface LogData {
  [key: string]: unknown;
}

function formatMessage(namespace: string, level: string, msg: string): string {
  return `[${namespace}:${level}] ${msg}`;
}

function formatData(data?: unknown): string {
  if (data === undefined || data === null) return '';
  if (typeof data === 'object') return ' ' + JSON.stringify(data);
  return ' ' + String(data);
}

export function createLogger(namespace: string) {
  return {
    info: (msg: string, data?: unknown): void => {
      console.info(formatMessage(namespace, 'info', msg) + formatData(data));
    },
    warn: (msg: string, data?: unknown): void => {
      console.warn(formatMessage(namespace, 'warn', msg) + formatData(data));
    },
    error: (msg: string, data?: unknown): void => {
      console.error(formatMessage(namespace, 'error', msg) + formatData(data));
    },
    debug: (msg: string, data?: unknown): void => {
      if (isDebugEnabled()) {
        console.debug(formatMessage(namespace, 'debug', msg) + formatData(data));
      }
    },
  };
}

/** Default research logger for general research base messages */
export const researchLog = createLogger('research');

/** Indexer-specific logger */
export const indexerLog = createLogger('research:indexer');

/** Watcher-specific logger */
export const watcherLog = createLogger('research:watcher');

/** Embeddings-specific logger */
export const embeddingsLog = createLogger('research:embeddings');

/** Provider switch-specific logger */
export const providerSwitchLog = createLogger('research:provider-switch');

/** Routes-specific logger */
export const routesLog = createLogger('research:routes');
