/**
 * Pure path helpers for .elefant/ directory structure.
 * No side effects, no I/O — just string composition.
 */

import { join } from 'node:path';

export const elefantDir = (projectPath: string): string =>
  join(projectPath, '.elefant');

export const dbPath = (projectPath: string): string =>
  join(elefantDir(projectPath), 'db.sqlite');

export const statePath = (projectPath: string): string =>
  join(elefantDir(projectPath), 'state.json');

export const logsDir = (projectPath: string): string =>
  join(elefantDir(projectPath), 'logs');

export const checkpointsDir = (projectPath: string): string =>
  join(elefantDir(projectPath), 'checkpoints');

export const memoryDir = (projectPath: string): string =>
  join(elefantDir(projectPath), 'memory');

export const pluginsDir = (projectPath: string): string =>
  join(elefantDir(projectPath), 'plugins');

export const researchBaseDir = (projectPath: string): string =>
  join(elefantDir(projectPath), 'markdown-db');

export const researchIndexPath = (projectPath: string): string =>
  join(elefantDir(projectPath), 'research-index.sqlite');

export const RESEARCH_SECTIONS: readonly string[] = [
  '00-index',
  '01-domain',
  '02-tech',
  '03-decisions',
  '04-comparisons',
  '05-references',
  '06-synthesis',
  '99-scratch',
] as const;

export const researchSectionDirs = (projectPath: string): string[] =>
  RESEARCH_SECTIONS.map((s) => join(researchBaseDir(projectPath), s));
