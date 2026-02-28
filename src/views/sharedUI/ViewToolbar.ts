import { setIcon, Menu, Notice } from 'obsidian';
import type { App, WorkspaceLeaf } from 'obsidian';
import { ViewUriBuilder, type LeafPosition, type ViewUriOptions } from '../../utils/ViewUriBuilder';
import { InputModal } from '../../modals/InputModal';
import type { ViewTemplate } from '../../types';
import { ViewTemplateLoader } from '../../services/template/ViewTemplateLoader';
import { ViewTemplateWriter } from '../../services/template/ViewTemplateWriter';

/**
 * Date navigation component with prev/next/today buttons.
 */
export class DateNavigator {
    /**
     * Renders date navigation buttons.
     * @param toolbar - Parent element to render into
     * @param onNavigate - Callback when navigating by days (e.g., -1 or +1)
     * @param onToday - Callback when clicking Today button
     */
    static render(
        toolbar: HTMLElement,
        onNavigate: (days: number) => void,
        onToday: () => void,
        options?: { vertical?: boolean }
    ): void {
        const vertical = options?.vertical ?? false;
        const prevIcon = vertical ? 'chevron-up' : 'chevron-left';
        const nextIcon = vertical ? 'chevron-down' : 'chevron-right';
        const prevLabel = vertical ? 'Previous week' : 'Previous day';
        const nextLabel = vertical ? 'Next week' : 'Next day';

        const prevBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(prevBtn, prevIcon);
        prevBtn.setAttribute('aria-label', prevLabel);
        prevBtn.onclick = () => onNavigate(-1);

        const todayBtn = toolbar.createEl('button', {
            cls: 'view-toolbar__btn--today',
            text: 'Today'
        });
        todayBtn.setAttribute('aria-label', 'Today');
        todayBtn.onclick = () => onToday();

        const nextBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(nextBtn, nextIcon);
        nextBtn.setAttribute('aria-label', nextLabel);
        nextBtn.onclick = () => onNavigate(1);
    }
}

/**
 * View mode selector (1 Day / 3 Days / Week).
 */
export class ViewModeSelector {
    static render(
        toolbar: HTMLElement,
        currentValue: number,
        onChange: (newValue: number) => void
    ): void {
        const getLabel = (val: number) => {
            if (val === 1) return '1 Day';
            if (val === 3) return '3 Days';
            return 'Week';
        };

        const button = toolbar.createEl('button', { cls: 'timeline-toolbar__btn--range timeline-toolbar__btn--view-mode' });
        const iconEl = button.createSpan('timeline-toolbar__btn-icon');
        const labelEl = button.createSpan({ cls: 'timeline-toolbar__btn-label' });
        setIcon(iconEl, 'chevrons-up-down');

        const applyModeLabel = (value: number) => {
            const label = getLabel(value);
            labelEl.setText(label);
            button.setAttribute('aria-label', `View mode: ${label}`);
        };
        applyModeLabel(currentValue);

        button.onclick = (e) => {
            const { Menu } = require('obsidian');
            const menu = new Menu();

            menu.addItem((item: any) => {
                item.setTitle('1 Day')
                    .setChecked(currentValue === 1)
                    .onClick(() => {
                        onChange(1);
                        applyModeLabel(1);
                    });
            });

            menu.addItem((item: any) => {
                item.setTitle('3 Days')
                    .setChecked(currentValue === 3)
                    .onClick(() => {
                        onChange(3);
                        applyModeLabel(3);
                    });
            });

            menu.addItem((item: any) => {
                item.setTitle('Week')
                    .setChecked(currentValue === 7)
                    .onClick(() => {
                        onChange(7);
                        applyModeLabel(7);
                    });
            });

            menu.showAtPosition({ x: e.pageX, y: e.pageY });
        };
    }
}

/**
 * Zoom selector for timeline scaling.
 */
export class ZoomSelector {
    /**
     * Renders zoom selector button with dropdown options.
     * @param toolbar - Parent element to render into
     * @param currentZoom - Current zoom level (e.g., 1.0 = 100%)
     * @param onZoomChange - Callback when zoom changes
     */
    static render(
        toolbar: HTMLElement,
        currentZoom: number,
        onZoomChange: (newZoom: number) => Promise<void>
    ): void {
        const button = toolbar.createEl('button', { cls: 'timeline-toolbar__btn--range timeline-toolbar__btn--zoom' });
        const iconEl = button.createSpan('timeline-toolbar__btn-icon');
        const labelEl = button.createSpan({ cls: 'timeline-toolbar__btn-label' });
        setIcon(iconEl, 'search');

        const applyLabel = (zoom: number) => {
            const pct = `${Math.round(zoom * 100)}%`;
            labelEl.setText(pct);
            button.setAttribute('aria-label', `Zoom: ${pct}`);
        };
        applyLabel(currentZoom);

        const zoomLevels = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0];
        button.onclick = (e) => {
            const { Menu } = require('obsidian');
            const menu = new Menu();
            for (const level of zoomLevels) {
                const pct = `${Math.round(level * 100)}%`;
                menu.addItem((item: any) => {
                    item.setTitle(pct)
                        .setChecked(currentZoom === level)
                        .onClick(async () => {
                            await onZoomChange(level);
                            applyLabel(level);
                        });
                });
            }
            menu.showAtPosition({ x: e.pageX, y: e.pageY });
        };
    }
}

/**
 * Position label mapping for display.
 */
const POSITION_LABELS: Record<LeafPosition, string> = {
    left: 'Left sidebar',
    right: 'Right sidebar',
    tab: 'Tab',
    window: 'Window',
    override: 'Override',
};

export interface ViewSettingsOptions {
    app: App;
    leaf: WorkspaceLeaf;
    getCustomName: () => string | undefined;
    getDefaultName: () => string;
    onRename: (newName: string | undefined) => void;
    buildUri: () => ViewUriOptions;
    viewType: string;
    getViewTemplateFolder: () => string;
    getViewTemplate: () => ViewTemplate;
    onApplyTemplate: (template: ViewTemplate) => void;
    onReset: () => void;
}

/**
 * View settings gear button and menu.
 * Provides: Rename, Save/Load view, Copy URI, Position display.
 */
export class ViewSettingsMenu {
    static renderButton(toolbar: HTMLElement, options: ViewSettingsOptions): HTMLElement {
        const btn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(btn, 'settings');
        btn.setAttribute('aria-label', 'View settings');
        btn.onclick = (e) => ViewSettingsMenu.showMenu(e, options);
        return btn;
    }

    static showMenu(e: MouseEvent, options: ViewSettingsOptions): void {
        const menu = new Menu();
        const {
            app, leaf, getCustomName, getDefaultName, onRename,
            buildUri, viewType, getViewTemplateFolder, getViewTemplate, onApplyTemplate, onReset,
        } = options;

        // Save view... (name required, saves template + updates customName)
        const folder = getViewTemplateFolder();
        menu.addItem((item) => {
            item.setTitle('Save view...')
                .setIcon('save')
                .onClick(() => {
                    if (!folder) {
                        new Notice('Set "View Template Folder" in Task Viewer settings first.');
                        return;
                    }
                    const defaultName = getCustomName() || getDefaultName();
                    new InputModal(
                        app,
                        'Save View',
                        'View name',
                        defaultName,
                        async (value) => {
                            const name = value.trim();
                            if (!name) return;
                            const template = getViewTemplate();
                            template.name = name;
                            const writer = new ViewTemplateWriter(app);
                            await writer.saveTemplate(folder, template);
                            onRename(name);
                            new Notice(`View saved as "${name}".`);
                        },
                    ).open();
                });
        });

        // Load view... (submenu)
        menu.addItem((item) => {
            item.setTitle('Load view...')
                .setIcon('folder-open');

            const shortViewType = ViewSettingsMenu.toShortViewType(viewType);

            if (!folder) {
                (item as any).setSubmenu().addItem((sub: any) =>
                    sub.setTitle('No folder configured').setDisabled(true));
            } else {
                const loader = new ViewTemplateLoader(app);
                const summaries = loader.loadTemplates(folder)
                    .filter(t => t.viewType === shortViewType);

                const submenu = (item as any).setSubmenu();
                if (summaries.length === 0) {
                    submenu.addItem((sub: any) =>
                        sub.setTitle('No templates found').setDisabled(true));
                } else {
                    for (const summary of summaries) {
                        submenu.addItem((sub: any) => {
                            sub.setTitle(summary.name)
                                .onClick(async () => {
                                    const full = await loader.loadFullTemplate(summary.filePath);
                                    if (full) onApplyTemplate(full);
                                    else new Notice('Failed to load template.');
                                });
                        });
                    }
                }
            }
        });

        // Reset view
        menu.addItem((item) => {
            item.setTitle('Reset view')
                .setIcon('rotate-ccw')
                .onClick(() => onReset());
        });

        menu.addSeparator();

        // Copy URI
        menu.addItem((item) => {
            item.setTitle('Copy URI')
                .setIcon('link')
                .onClick(async () => {
                    const uriOpts = buildUri();
                    uriOpts.position = ViewUriBuilder.detectLeafPosition(leaf, app.workspace);
                    uriOpts.name = getCustomName();

                    // Use template reference if folder is configured
                    if (folder) {
                        uriOpts.template = getCustomName() || getDefaultName();
                    }

                    const uri = ViewUriBuilder.build(viewType, uriOpts);
                    await navigator.clipboard.writeText(uri);
                    new Notice('URI copied to clipboard');
                });
        });

        // Copy as Obsidian link [name](uri)
        menu.addItem((item) => {
            item.setTitle('Copy as link')
                .setIcon('external-link')
                .onClick(async () => {
                    const uriOpts = buildUri();
                    uriOpts.position = ViewUriBuilder.detectLeafPosition(leaf, app.workspace);
                    uriOpts.name = getCustomName();

                    if (folder) {
                        uriOpts.template = getCustomName() || getDefaultName();
                    }

                    const uri = ViewUriBuilder.build(viewType, uriOpts);
                    const displayName = getCustomName() || getDefaultName();
                    const link = `[${displayName}](${uri})`;
                    await navigator.clipboard.writeText(link);
                    new Notice('Link copied to clipboard');
                });
        });

        menu.addSeparator();

        // Position (read-only)
        menu.addItem((item) => {
            item.setTitle('Position').setDisabled(true);
        });

        const pos = ViewUriBuilder.detectLeafPosition(leaf, app.workspace);
        menu.addItem((item) => {
            item.setTitle(`  ${POSITION_LABELS[pos]}`)
                .setChecked(true)
                .setDisabled(true);
        });

        menu.showAtMouseEvent(e);
    }

    private static toShortViewType(viewType: string): string {
        return viewType.replace(/-view$/, '');
    }
}
