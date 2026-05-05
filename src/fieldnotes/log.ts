/**
 * Field Notes logging utilities.
 *
 * All field notes modules log under the `fieldnotes:` namespace for consistent
 * observability. The logger respects the DEBUG environment variable to
 * enable debug-level output when `DEBUG` includes 'fieldnotes'.
 */

function isDebugEnabled(): boolean {
  return Bun.env.DEBUG?.includes('fieldnotes') ?? false;
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

/** Default field notes logger for general field notes messages */
export const fieldNotesLog = createLogger('fieldnotes');

/** Indexer-specific logger */
export const indexerLog = createLogger('fieldnotes:indexer');

/** Watcher-specific logger */
export const watcherLog = createLogger('fieldnotes:watcher');

/** Embeddings-specific logger */
export const embeddingsLog = createLogger('fieldnotes:embeddings');

/** Provider switch-specific logger */
export const providerSwitchLog = createLogger('fieldnotes:provider-switch');

/** Routes-specific logger */
export const fieldNotesRoutesLog = createLogger('fieldnotes:routes');

/** Alias used by routes-fieldnotes.ts */
export const routesLog = fieldNotesRoutesLog;
