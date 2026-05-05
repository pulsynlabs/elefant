import { existsSync, watch, type FSWatcher } from 'node:fs';
import { resolve } from 'node:path';
import { researchBaseDir } from '../project/paths.ts';
import { watcherLog } from './log.ts';

export interface WatcherOptions {
  projectPath: string;
  debounceMs?: number;
  onChanged: (filePath: string) => Promise<void>;
  onRemoved: (filePath: string) => Promise<void>;
}

export class FieldNotesWatcher {
  private watcher: FSWatcher | null = null;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly debounceMs: number;
  private stopped = true;

  constructor(private readonly opts: WatcherOptions) {
    this.debounceMs = opts.debounceMs ?? 500;
  }

  start(): void {
    if (this.watcher !== null) return;
    this.stopped = false;
    const base = researchBaseDir(this.opts.projectPath);
    watcherLog.info('watcher started', { dir: base, debounceMs: this.debounceMs });
    this.watcher = watch(base, { recursive: true }, (eventType, filename) => {
      if (this.stopped || !filename) return;
      const filePath = resolve(base, String(filename));
      if (!filePath.endsWith('.md')) return;
      this.schedule(filePath, eventType === 'rename' ? 'rename' : 'change');
    });
    this.watcher.on('error', (error) => {
      watcherLog.warn('watcher error', { error: String(error) });
    });
  }

  stop(): void {
    this.stopped = true;
    watcherLog.info('watcher stopped');
    if (this.watcher !== null) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private schedule(filePath: string, type: 'change' | 'rename'): void {
    const existing = this.timers.get(filePath);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(filePath);
      if (this.stopped) return;
      const exists = existsSync(filePath);
      if (type === 'rename' && !exists) {
        watcherLog.info('file removed', { path: filePath });
      } else {
        watcherLog.info('file changed', { path: filePath });
      }
      const callback = type === 'rename' && !exists ? this.opts.onRemoved : this.opts.onChanged;
      callback(filePath).catch(() => undefined);
    }, this.debounceMs);
    this.timers.set(filePath, timer);
  }
}
