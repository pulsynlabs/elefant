import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { createLogger, researchLog, indexerLog, watcherLog, embeddingsLog, providerSwitchLog, routesLog } from './log.ts';

describe('log', () => {
  let infoSpy: string[] = [];
  let warnSpy: string[] = [];
  let errorSpy: string[] = [];
  let debugSpy: string[] = [];
  let originalInfo: typeof console.info;
  let originalWarn: typeof console.warn;
  let originalError: typeof console.error;
  let originalDebug: typeof console.debug;
  let originalDebugEnv: string | undefined;

  beforeEach(() => {
    infoSpy = [];
    warnSpy = [];
    errorSpy = [];
    debugSpy = [];
    originalInfo = console.info;
    originalWarn = console.warn;
    originalError = console.error;
    originalDebug = console.debug;
    originalDebugEnv = Bun.env.DEBUG;

    console.info = (msg?: unknown, ...args: unknown[]) => {
      infoSpy.push(String(msg) + (args.length ? ' ' + args.map(String).join(' ') : ''));
    };
    console.warn = (msg?: unknown, ...args: unknown[]) => {
      warnSpy.push(String(msg) + (args.length ? ' ' + args.map(String).join(' ') : ''));
    };
    console.error = (msg?: unknown, ...args: unknown[]) => {
      errorSpy.push(String(msg) + (args.length ? ' ' + args.map(String).join(' ') : ''));
    };
    console.debug = (msg?: unknown, ...args: unknown[]) => {
      debugSpy.push(String(msg) + (args.length ? ' ' + args.map(String).join(' ') : ''));
    };
  });

  afterEach(() => {
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
    console.debug = originalDebug;
    if (originalDebugEnv === undefined) {
      delete Bun.env.DEBUG;
    } else {
      Bun.env.DEBUG = originalDebugEnv;
    }
  });

  describe('createLogger', () => {
    test('logs info messages with namespace prefix', () => {
      const log = createLogger('test:ns');
      log.info('hello world');
      expect(infoSpy).toHaveLength(1);
      expect(infoSpy[0]).toMatch(/\[test:ns:info\] hello world/);
    });

    test('logs info messages with data object', () => {
      const log = createLogger('test:ns');
      log.info('event', { key: 'value', num: 42 });
      expect(infoSpy).toHaveLength(1);
      expect(infoSpy[0]).toMatch(/\[test:ns:info\] event/);
      expect(infoSpy[0]).toMatch(/"key":"value"/);
      expect(infoSpy[0]).toMatch(/"num":42/);
    });

    test('logs warn messages with namespace prefix', () => {
      const log = createLogger('test:ns');
      log.warn('warning message');
      expect(warnSpy).toHaveLength(1);
      expect(warnSpy[0]).toMatch(/\[test:ns:warn\] warning message/);
    });

    test('logs error messages with namespace prefix', () => {
      const log = createLogger('test:ns');
      log.error('error message');
      expect(errorSpy).toHaveLength(1);
      expect(errorSpy[0]).toMatch(/\[test:ns:error\] error message/);
    });

    test('debug logs only when DEBUG includes research', () => {
      Bun.env.DEBUG = 'other';
      const log = createLogger('test:ns');
      log.debug('debug message');
      expect(debugSpy).toHaveLength(0);

      Bun.env.DEBUG = 'research';
      log.debug('debug message 2');
      expect(debugSpy).toHaveLength(1);
      expect(debugSpy[0]).toMatch(/\[test:ns:debug\] debug message 2/);
    });

    test('handles undefined data gracefully', () => {
      const log = createLogger('test:ns');
      log.info('no data');
      expect(infoSpy).toHaveLength(1);
      expect(infoSpy[0]).not.toMatch(/undefined/);
    });
  });

  describe('predefined loggers', () => {
    test('researchLog uses research namespace', () => {
      researchLog.info('test');
      expect(infoSpy[0]).toMatch(/\[research:info\]/);
    });

    test('indexerLog uses research:indexer namespace', () => {
      indexerLog.info('test');
      expect(infoSpy[0]).toMatch(/\[research:indexer:info\]/);
    });

    test('watcherLog uses research:watcher namespace', () => {
      watcherLog.info('test');
      expect(infoSpy[0]).toMatch(/\[research:watcher:info\]/);
    });

    test('embeddingsLog uses research:embeddings namespace', () => {
      embeddingsLog.info('test');
      expect(infoSpy[0]).toMatch(/\[research:embeddings:info\]/);
    });

    test('providerSwitchLog uses research:provider-switch namespace', () => {
      providerSwitchLog.info('test');
      expect(infoSpy[0]).toMatch(/\[research:provider-switch:info\]/);
    });

    test('routesLog uses research:routes namespace', () => {
      routesLog.info('test');
      expect(infoSpy[0]).toMatch(/\[research:routes:info\]/);
    });
  });
});
