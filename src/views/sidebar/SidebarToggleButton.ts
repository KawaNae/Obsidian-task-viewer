import { setIcon } from 'obsidian';

/**
 * Updates a sidebar toggle button's icon, classes, and aria-label
 * to reflect the current open/closed state.
 */
export function updateSidebarToggleButton(btn: HTMLElement, isOpen: boolean): void {
    const primaryIcon = isOpen ? 'panel-right-open' : 'panel-right-close';
    const fallbackIcon = isOpen ? 'sidebar-right' : 'sidebar-left';

    setIcon(btn, primaryIcon);
    if (!btn.querySelector('svg')) {
        setIcon(btn, fallbackIcon);
    }

    btn.classList.toggle('is-open', isOpen);
    btn.classList.toggle('is-closed', !isOpen);
    btn.classList.toggle('is-active', isOpen);

    const label = isOpen ? 'Hide Sidebar' : 'Show Sidebar';
    btn.setAttribute('aria-label', label);
}
