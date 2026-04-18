// Icon Registry — Elefant Design System
// Re-exports HugeIcons for consistent usage across the app.
// All icons are imported from @hugeicons/core-free-icons and rendered
// via the HugeiconsIcon component from @hugeicons/svelte.

export { HugeiconsIcon } from '@hugeicons/svelte';
export type { HugeiconsProps, IconSvgElement } from '@hugeicons/svelte';

// --- Semantic icon mappings ---
// Navigation
export { default as ChatIcon } from '@hugeicons/core-free-icons/ChatIcon';
export { default as SettingsIcon } from '@hugeicons/core-free-icons/Settings02Icon';
export { default as ModelsIcon } from '@hugeicons/core-free-icons/GridViewIcon';
export { default as AboutIcon } from '@hugeicons/core-free-icons/InformationCircleIcon';

// Actions
export { default as CloseIcon } from '@hugeicons/core-free-icons/Cancel01Icon';
export { default as MenuIcon } from '@hugeicons/core-free-icons/Menu01Icon';
export { default as SearchIcon } from '@hugeicons/core-free-icons/Search01Icon';
export { default as PlusIcon } from '@hugeicons/core-free-icons/PlusSignIcon';
export { default as CheckIcon } from '@hugeicons/core-free-icons/Tick02Icon';
export { default as CopyIcon } from '@hugeicons/core-free-icons/Copy01Icon';

// Directional
export { default as ChevronRightIcon } from '@hugeicons/core-free-icons/ArrowRight01Icon';
export { default as ChevronDownIcon } from '@hugeicons/core-free-icons/ArrowDown01Icon';

// Theme
export { default as SunIcon } from '@hugeicons/core-free-icons/Sun01Icon';
export { default as MoonIcon } from '@hugeicons/core-free-icons/Moon02Icon';

// Status / Feedback
export { default as WarningIcon } from '@hugeicons/core-free-icons/Alert01Icon';
export { default as ErrorIcon } from '@hugeicons/core-free-icons/AlertCircleIcon';
export { default as InfoIcon } from '@hugeicons/core-free-icons/InformationCircleIcon';

// Utility
export { default as TerminalIcon } from '@hugeicons/core-free-icons/TerminalIcon';
