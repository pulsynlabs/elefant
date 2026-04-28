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
export { default as CrossIcon } from '@hugeicons/core-free-icons/Cancel01Icon';
export { default as CheckSquareIcon } from '@hugeicons/core-free-icons/CheckmarkSquare02Icon';
export { default as UncheckSquareIcon } from '@hugeicons/core-free-icons/Square01Icon';

// Utility
export { default as TerminalIcon } from '@hugeicons/core-free-icons/TerminalIcon';
export { default as EditIcon } from '@hugeicons/core-free-icons/Edit02Icon';
export { default as DeleteIcon } from '@hugeicons/core-free-icons/Delete02Icon';
export { default as FolderIcon } from '@hugeicons/core-free-icons/Folder01Icon';
export { default as FolderAddIcon } from '@hugeicons/core-free-icons/FolderAddIcon';
export { default as FlashIcon } from '@hugeicons/core-free-icons/FlashIcon';
export { default as CommandIcon } from '@hugeicons/core-free-icons/CommandIcon';
export { default as GithubIcon } from '@hugeicons/core-free-icons/Github01Icon';
export { default as ViewIcon } from '@hugeicons/core-free-icons/ViewIcon';
export { default as ViewOffIcon } from '@hugeicons/core-free-icons/ViewOffIcon';
export { default as BotIcon } from '@hugeicons/core-free-icons/BotIcon';

// New feature icons (MH3, MH4, MH5)
export { default as AgentsIcon } from '@hugeicons/core-free-icons/UserGroupIcon';
export { default as AiBrain01Icon } from '@hugeicons/core-free-icons/AiBrain01Icon';
export { default as RunsIcon } from '@hugeicons/core-free-icons/PlayIcon';
export { default as WorktreesIcon } from '@hugeicons/core-free-icons/FolderTreeIcon';
