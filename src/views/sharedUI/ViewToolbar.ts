import { setIcon, Menu, Notice } from 'obsidian';
import type { App, MenuItem, WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import { ViewUriBuilder, type LeafPosition, type ViewUriOptions } from '../../utils/ViewUriBuilder';
import { InputModal } from '../../modals/InputModal';
import type { ViewTemplate } from '../../types';
import { ViewTemplateLoader } from '../../services/template/ViewTemplateLoader';
import { ViewTemplateWriter } from '../../services/template/ViewTemplateWriter';
import { ViewExporter } from '../../services/export/ViewExporter';
import type { ExportStrategy } from '../../services/export/ExportTypes';
import type { TaskIndex } from '../../services/core/TaskIndex';

/**
 * Date navigation component with prev/next/today buttons.
 */
export class DateNavigator {
    /**
     * Renders date navigation buttons.
     * @param toolbar - Parent element to render into
     * @param onNavigate - Callback when navigating by days (e.g., -1 or +1)
     * @param onToday - Callback when clicking Now button
     */
    static render(
        toolbar: HTMLElement,
        onNavigate: (days: number) => void,
        onToday: () => void,
        options?: { vertical?: boolean; label?: string; onNavigateFast?: (direction: number) => void }
    ): void {
        const vertical = options?.vertical ?? false;
        const label = options?.label ?? t('toolbar.today');
        const prevIcon = vertical ? 'chevron-up' : 'chevron-left';
        const nextIcon = vertical ? 'chevron-down' : 'chevron-right';
        const prevLabel = vertical ? t('toolbar.previousWeek') : t('toolbar.previousDay');
        const nextLabel = vertical ? t('toolbar.nextWeek') : t('toolbar.nextDay');

        if (options?.onNavigateFast) {
            const fastPrevIcon = vertical ? 'chevrons-up' : 'chevrons-left';
            const fastPrevBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
            setIcon(fastPrevBtn, fastPrevIcon);
            fastPrevBtn.setAttribute('aria-label', t('toolbar.previousMonth'));
            const onFastPrev = options.onNavigateFast;
            fastPrevBtn.onclick = () => onFastPrev(-1);
        }

        const prevBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(prevBtn, prevIcon);
        prevBtn.setAttribute('aria-label', prevLabel);
        prevBtn.onclick = () => onNavigate(-1);

        const todayBtn = toolbar.createEl('button', {
            cls: 'view-toolbar__btn--today',
            text: label
        });
        todayBtn.setAttribute('aria-label', label);
        todayBtn.onclick = () => onToday();

        const nextBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(nextBtn, nextIcon);
        nextBtn.setAttribute('aria-label', nextLabel);
        nextBtn.onclick = () => onNavigate(1);

        if (options?.onNavigateFast) {
            const fastNextIcon = vertical ? 'chevrons-down' : 'chevrons-right';
            const fastNextBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
            setIcon(fastNextBtn, fastNextIcon);
            fastNextBtn.setAttribute('aria-label', t('toolbar.nextMonth'));
            const onFastNext = options.onNavigateFast;
            fastNextBtn.onclick = () => onFastNext(1);
        }
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
            if (val === 1) return t('toolbar.viewMode1Day');
            if (val === 3) return t('toolbar.viewMode3Days');
            return t('toolbar.viewModeWeek');
        };

        const button = toolbar.createEl('button', { cls: 'timeline-toolbar__btn--range timeline-toolbar__btn--view-mode' });
        const iconEl = button.createSpan('timeline-toolbar__btn-icon');
        const labelEl = button.createSpan({ cls: 'timeline-toolbar__btn-label' });
        setIcon(iconEl, 'chevrons-up-down');

        const applyModeLabel = (value: number) => {
            const label = getLabel(value);
            labelEl.setText(label);
            button.setAttribute('aria-label', t('toolbar.viewModeLabel', { label }));
        };
        applyModeLabel(currentValue);

        button.onclick = (e) => {
            const menu = new Menu();

            menu.addItem((item: MenuItem) => {
                item.setTitle(t('toolbar.viewMode1Day'))
                    .setChecked(currentValue === 1)
                    .onClick(() => {
                        onChange(1);
                        applyModeLabel(1);
                    });
            });

            menu.addItem((item: MenuItem) => {
                item.setTitle(t('toolbar.viewMode3Days'))
                    .setChecked(currentValue === 3)
                    .onClick(() => {
                        onChange(3);
                        applyModeLabel(3);
                    });
            });

            menu.addItem((item: MenuItem) => {
                item.setTitle(t('toolbar.viewModeWeek'))
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
            button.setAttribute('aria-label', t('toolbar.zoomLabel', { pct }));
        };
        applyLabel(currentZoom);

        const zoomLevels = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0];
        button.onclick = (e) => {
            const menu = new Menu();
            for (const level of zoomLevels) {
                const pct = `${Math.round(level * 100)}%`;
                menu.addItem((item: MenuItem) => {
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
function getPositionLabel(pos: LeafPosition): string {
    const map: Record<LeafPosition, string> = {
        left: t('position.leftSidebar'),
        right: t('position.rightSidebar'),
        tab: t('position.tab'),
        window: t('position.window'),
        override: t('position.override'),
    };
    return map[pos];
}

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
    getExportContainer?: () => HTMLElement | null;
    getTaskIndex?: () => TaskIndex;
    getExportStrategy?: () => ExportStrategy;
}

/**
 * View settings gear button and menu.
 * Provides: Rename, Save/Load view, Copy URI, Position display.
 */
export class ViewSettingsMenu {
    static renderButton(toolbar: HTMLElement, options: ViewSettingsOptions): HTMLElement {
        const btn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(btn, 'settings');
        btn.setAttribute('aria-label', t('toolbar.viewSettings'));
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
            item.setTitle(t('toolbar.saveView'))
                .setIcon('save')
                .onClick(() => {
                    if (!folder) {
                        new Notice(t('notice.setViewTemplateFolder'));
                        return;
                    }
                    const defaultName = getCustomName() || getDefaultName();
                    new InputModal(
                        app,
                        t('toolbar.saveViewTitle'),
                        t('toolbar.saveViewLabel'),
                        defaultName,
                        async (value) => {
                            const name = value.trim();
                            if (!name) return;
                            const template = getViewTemplate();
                            template.name = name;
                            const writer = new ViewTemplateWriter(app);
                            await writer.saveTemplate(folder, template);
                            onRename(name);
                            new Notice(t('notice.viewSaved', { name }));
                        },
                    ).open();
                });
        });

        // Load view... (submenu)
        menu.addItem((item) => {
            item.setTitle(t('toolbar.loadView'))
                .setIcon('folder-open');

            const shortViewType = ViewSettingsMenu.toShortViewType(viewType);

            if (!folder) {
                (item as any).setSubmenu().addItem((sub: any) =>
                    sub.setTitle(t('toolbar.noFolderConfigured')).setDisabled(true));
            } else {
                const loader = new ViewTemplateLoader(app);
                const summaries = loader.loadTemplates(folder)
                    .filter(s => s.viewType === shortViewType);

                const submenu = (item as any).setSubmenu();
                if (summaries.length === 0) {
                    submenu.addItem((sub: any) =>
                        sub.setTitle(t('toolbar.noTemplatesFound')).setDisabled(true));
                } else {
                    for (const summary of summaries) {
                        submenu.addItem((sub: any) => {
                            sub.setTitle(summary.name)
                                .onClick(async () => {
                                    const full = await loader.loadFullTemplate(summary.filePath);
                                    if (full) onApplyTemplate(full);
                                    else new Notice(t('notice.failedToLoadTemplate'));
                                });
                        });
                    }
                }
            }
        });

        // Reset view
        menu.addItem((item) => {
            item.setTitle(t('toolbar.resetView'))
                .setIcon('rotate-ccw')
                .onClick(() => onReset());
        });

        menu.addSeparator();

        // Copy URI
        menu.addItem((item) => {
            item.setTitle(t('toolbar.copyUri'))
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
                    new Notice(t('notice.uriCopied'));
                });
        });

        // Copy as Obsidian link [name](uri)
        menu.addItem((item) => {
            item.setTitle(t('toolbar.copyAsLink'))
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
                    new Notice(t('notice.linkCopied'));
                });
        });

        // Export as image
        if (options.getExportContainer && options.getTaskIndex && options.getExportStrategy) {
            menu.addSeparator();
            const getContainer = options.getExportContainer;
            const getIndex = options.getTaskIndex;
            const getStrategy = options.getExportStrategy;

            const doExport = async (expandScrollAreas: boolean) => {
                const container = getContainer();
                if (!container) {
                    new Notice(t('notice.noContentToExport'));
                    return;
                }
                const shortType = ViewSettingsMenu.toShortViewType(viewType);
                const date = new Date().toISOString().slice(0, 10);
                const name = getCustomName();
                const filename = name
                    ? `${name}_${date}.png`
                    : `${shortType}_${date}.png`;
                await ViewExporter.exportAsPng({
                    app: options.app,
                    container,
                    taskIndex: getIndex(),
                    filename,
                    expandScrollAreas,
                }, getStrategy());
            };

            menu.addItem((item) => {
                item.setTitle(t('toolbar.exportVisibleAsImage'))
                    .setIcon('image')
                    .onClick(() => doExport(false));
            });
            menu.addItem((item) => {
                item.setTitle(t('toolbar.exportFullAsImage'))
                    .setIcon('maximize')
                    .onClick(() => doExport(true));
            });
        }

        menu.addSeparator();

        // Position (read-only)
        menu.addItem((item) => {
            item.setTitle(t('toolbar.position')).setDisabled(true);
        });

        const pos = ViewUriBuilder.detectLeafPosition(leaf, app.workspace);
        menu.addItem((item) => {
            item.setTitle(`  ${getPositionLabel(pos)}`)
                .setChecked(true)
                .setDisabled(true);
        });

        menu.showAtMouseEvent(e);
    }

    private static toShortViewType(viewType: string): string {
        return viewType.replace(/-view$/, '');
    }
}
