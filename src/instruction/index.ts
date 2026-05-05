// instruction module — barrel exports
//
// Exports the stable contract surface so later tasks (resolver.ts, loader.ts,
// guard.ts) plug into a single import path.

export type { CodebaseDigest, LoadedInstruction, InstructionService, ManifestInfo } from './types.ts';
export { INSTRUCTION_FILES, MAX_BYTES, LINE_TARGET } from './types.ts';
export { findInstruction, resolveForFile, resolveRoot } from './resolver.ts';
export { createInstructionService, invalidate, invalidateAll, loadContent } from './loader.ts';
export { applyInstructionGuard } from './guard.ts';
export type { InstructionGuardInput, InstructionGuardResult } from './guard.ts';
export { analyzeCodebase } from './codebase-analysis.ts';
export { registerAcceptanceTrigger } from './acceptance-trigger.ts';
export type { AcceptanceTriggerDeps } from './acceptance-trigger.ts';
