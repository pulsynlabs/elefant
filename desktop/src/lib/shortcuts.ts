export type ShortcutAction = 'settings' | 'new-chat';

export interface Shortcut {
	key: string;
	meta: boolean;
	ctrl: boolean;
	action: ShortcutAction;
}

const isMac = navigator.platform.toUpperCase().includes('MAC') ||
	navigator.userAgent.includes('Mac OS X');

export const SHORTCUTS: Shortcut[] = [
	{
		key: ',',
		meta: isMac,
		ctrl: !isMac,
		action: 'settings',
	},
	{
		key: 'n',
		meta: isMac,
		ctrl: !isMac,
		action: 'new-chat',
	},
];

export function matchesShortcut(event: KeyboardEvent, shortcut: Shortcut): boolean {
	const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase();

	if (isMac) {
		// On macOS: Meta (Cmd) shortcuts
		return keyMatch && event.metaKey && !event.ctrlKey;
	} else {
		// On Windows/Linux: Ctrl shortcuts
		return keyMatch && event.ctrlKey && !event.metaKey;
	}
}

export function getShortcutLabel(shortcut: Shortcut): string {
	const modifier = isMac ? 'Cmd+' : 'Ctrl+';
	return `${modifier}${shortcut.key.toUpperCase()}`;
}
