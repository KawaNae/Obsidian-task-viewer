import { setIcon, Notice } from 'obsidian';
import type { App, Menu, MenuItem, WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import { ViewUriBuilder, type LeafPosition, type ViewUriOptions } from '../sharedLogic/ViewUriBuilder';
import { InputModal } from '../../modals/InputModal';
import type { ViewTemplate } from '../../types';
import { ViewTemplateLoader } from '../../services/template/ViewTemplateLoader';
import { ViewTemplateWriter } from '../../services/template/ViewTemplateWriter';
import { ViewExporter } from '../../services/export/ViewExporter';
import { exportDescriptorFor, resolveExportContainer } from '../../services/export/ExportRegistry';
import type { MenuPresenter } from '../../interaction/menu/MenuPresenter';

/**
 * Persistent toolbar root with mount/detach lifecycle.
 *
 * Subclasses implement `buildDom(rootEl)` to create button DOM and may override
 * `update()` for dynamic refreshes. The view calls `mount(host)` after creating
 * its toolbar host, and `detach()` before container.empty() so the rootEl + any
 * child components (filter popover anchors, etc.) survive the re-render.
 *
 * Pass `{ dynamicContent: true }` to the constructor for toolbars whose inner
 * DOM depends on state that changes between renders (e.g. month labels in
 * mini-calendar, timer-mode controls). Such toolbars rebuild their content on
 * every mount; static toolbars rebuild only on first mount.
 */
export abstract class ViewToolbarBase {
    protected host: HTMLElement | null = null;
    protected rootEl: HTMLElement | null = null;
    private readonly dynamicContent: boolean;

    constructor(options: { dynamicContent?: boolean } = {}) {
        this.dynamicContent = options.dynamicContent ?? false;
    }

    /** Returns the toolbar root element (after first mount) for callers that
     * need to read/write data attributes or measure the DOM. */
    getRootEl(): HTMLElement | null {
        return this.rootEl;
    }

    mount(host: HTMLElement): void {
        if (this.rootEl) {
            if (this.host !== host || this.rootEl.parentElement !== host) {
                host.appendChild(this.rootEl);
                this.host = host;
            }
            if (this.dynamicContent) {
                this.rootEl.empty();
                this.buildDom(this.rootEl);
            }
            this.update();
            return;
        }
        this.host = host;
        this.rootEl = host.createDiv('view-toolbar');
        this.buildDom(this.rootEl);
        this.update();
    }

    detach(): void {
        if (this.rootEl?.parentElement) {
            this.rootEl.parentElement.removeChild(this.rootEl);
        }
        this.host = null;
    }

    /** Refresh dynamic UI without rebuilding DOM. Override in subclasses. */
    update(): void {}

    protected abstract buildDom(rootEl: HTMLElement): void;
}

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
        options?: { vertical?: boolean; onNavigateFast?: (direction: number) => void }
    ): void {
        const vertical = options?.vertical ?? false;
        const prevIcon = vertical ? 'chevron-up' : 'chevron-left';
        const nextIcon = vertical ? 'chevron-down' : 'chevron-right';
        const prevLabel = vertical ? t('toolbar.previousWeek') : t('toolbar.previousDay');
        const nextLabel = vertical ? t('toolbar.nextWeek') : t('toolbar.nextDay');

        const navGroup = toolbar.createDiv('view-toolbar__nav-group');

        if (options?.onNavigateFast) {
            const fastPrevIcon = vertical ? 'chevrons-up' : 'chevrons-left';
            const fastPrevBtn = navGroup.createEl('button', { cls: 'view-toolbar__btn--icon' });
            setIcon(fastPrevBtn, fastPrevIcon);
            fastPrevBtn.setAttribute('aria-label', t('toolbar.previousMonth'));
            const onFastPrev = options.onNavigateFast;
            fastPrevBtn.onclick = () => onFastPrev(-1);
        }

        const prevBtn = navGroup.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(prevBtn, prevIcon);
        prevBtn.setAttribute('aria-label', prevLabel);
        prevBtn.onclick = () => onNavigate(-1);

        const todayBtn = navGroup.createEl('button', {
            cls: 'view-toolbar__btn--today',
            text: t('toolbar.today'),
        });
        todayBtn.setAttribute('aria-label', t('toolbar.today'));
        todayBtn.onclick = () => onToday();

        const nextBtn = navGroup.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(nextBtn, nextIcon);
        nextBtn.setAttribute('aria-label', nextLabel);
        nextBtn.onclick = () => onNavigate(1);

        if (options?.onNavigateFast) {
            const fastNextIcon = vertical ? 'chevrons-down' : 'chevrons-right';
            const fastNextBtn = navGroup.createEl('button', { cls: 'view-toolbar__btn--icon' });
            setIcon(fastNextBtn, fastNextIcon);
            fastNextBtn.setAttribute('aria-label', t('toolbar.nextMonth'));
            const onFastNext = options.onNavigateFast;
            fastNextBtn.onclick = () => onFastNext(1);
        }
    }
}

/**
 * View mode selector (1 Day / 3 Days / Week).
 *
 * Returns an `update()` handle so external state changes (layout restore, URI
 * params, template apply) can refresh the label. Reads `getValue()` lazily on
 * every menu open so the checked item always reflects current state.
 */
export class ViewModeSelector {
    static render(
        toolbar: HTMLElement,
        getValue: () => number,
        onChange: (newValue: number) => void,
        menuPresenter: MenuPresenter
    ): { update: () => void } {
        const getLabel = (val: number) => {
            if (val === 1) return t('toolbar.viewMode1Day');
            if (val === 3) return t('toolbar.viewMode3Days');
            return t('toolbar.viewModeWeek');
        };

        const button = toolbar.createEl('button', { cls: 'timeline-toolbar__btn--range timeline-toolbar__btn--view-mode' });
        const iconEl = button.createSpan('timeline-toolbar__btn-icon');
        const labelEl = button.createSpan({ cls: 'timeline-toolbar__btn-label' });
        setIcon(iconEl, 'chevrons-up-down');

        const update = () => {
            const label = getLabel(getValue());
            labelEl.setText(label);
            button.setAttribute('aria-label', t('toolbar.viewModeLabel', { label }));
        };
        update();

        const options: Array<{ value: number; title: string }> = [
            { value: 1, title: t('toolbar.viewMode1Day') },
            { value: 3, title: t('toolbar.viewMode3Days') },
            { value: 7, title: t('toolbar.viewModeWeek') },
        ];

        button.onclick = (e) => {
            const current = getValue();
            menuPresenter.present((menu) => {
                for (const opt of options) {
                    menu.addItem((item: MenuItem) => {
                        item.setTitle(opt.title)
                            .setChecked(current === opt.value)
                            .onClick(() => {
                                onChange(opt.value);
                                update();
                            });
                    });
                }
            }, { kind: 'position', x: e.pageX, y: e.pageY });
        };

        return { update };
    }
}

/**
 * Zoom selector for timeline scaling.
 */
export class ZoomSelector {
    /**
     * Renders zoom selector button with dropdown options.
     * @param toolbar - Parent element to render into
     * @param getZoom - Lazy reader for the current zoom level (1.0 = 100%)
     * @param onZoomChange - Callback when zoom changes
     * @returns `update()` to refresh the label after external state changes
     */
    static render(
        toolbar: HTMLElement,
        getZoom: () => number,
        onZoomChange: (newZoom: number) => Promise<void>,
        menuPresenter: MenuPresenter
    ): { update: () => void } {
        const button = toolbar.createEl('button', { cls: 'timeline-toolbar__btn--range timeline-toolbar__btn--zoom' });
        const iconEl = button.createSpan('timeline-toolbar__btn-icon');
        const labelEl = button.createSpan({ cls: 'timeline-toolbar__btn-label' });
        setIcon(iconEl, 'chevrons-up-down');

        const update = () => {
            const pct = `${Math.round(getZoom() * 100)}%`;
            labelEl.setText(pct);
            button.setAttribute('aria-label', t('toolbar.zoomLabel', { pct }));
        };
        update();

        const zoomLevels = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0];
        button.onclick = (e) => {
            const current = getZoom();
            menuPresenter.present((menu) => {
                for (const level of zoomLevels) {
                    const pct = `${Math.round(level * 100)}%`;
                    menu.addItem((item: MenuItem) => {
                        item.setTitle(pct)
                            .setChecked(current === level)
                            .onClick(async () => {
                                await onZoomChange(level);
                                update();
                            });
                    });
                }
            }, { kind: 'position', x: e.pageX, y: e.pageY });
        };

        return { update };
    }
}

/**
 * Toolbar toggle for the per-view "mask mode" — when enabled, every task card
 * rendered through TaskCardRenderer substitutes its content with the task's
 * `tv-mask` value. State lives on each view (persisted via setState/getState
 * and ViewTemplate), this helper only knows how to draw and dispatch toggles.
 *
 * Visual contract: icon swaps `eye` ↔ `eye-off` to mirror state. `is-active`
 * class doubles the cue so theme authors can style it independently.
 */
export class MaskToggleButton {
    static render(
        toolbar: HTMLElement,
        options: { getMaskMode: () => boolean; setMaskMode: (next: boolean) => void }
    ): { update: () => void } {
        const btn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });

        const update = () => {
            const on = options.getMaskMode();
            // Clear previous icon before swapping; setIcon does not strip the
            // previous SVG, and we toggle this on the same element repeatedly.
            btn.empty();
            setIcon(btn, on ? 'eye-off' : 'eye');
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-label', t('toolbar.maskMode'));
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        };
        update();

        btn.onclick = () => {
            options.setMaskMode(!options.getMaskMode());
            update();
        };

        return { update };
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
    menuPresenter: MenuPresenter;
    getExportFolder?: () => string;
    /** View-specific menu items appended above the Save/Load/Reset block.
     *  Used by views to surface their own overlay/display toggles
     *  (e.g. astronomy) without bloating the shared option list. */
    appendCustomItems?: (menu: Menu) => void;
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
        options.menuPresenter.present((menu) => {
            ViewSettingsMenu.appendItems(menu, options);
        }, { kind: 'mouseEvent', event: e });
    }

    static appendItems(menu: Menu, options: ViewSettingsOptions): void {
        const {
            app, leaf, getCustomName, getDefaultName, onRename,
            buildUri, viewType, getViewTemplateFolder, getViewTemplate, onApplyTemplate, onReset,
            appendCustomItems,
        } = options;

        const folder = getViewTemplateFolder();

        if (appendCustomItems) {
            appendCustomItems(menu);
            menu.addSeparator();
        }

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

        menu.addItem((item) => {
            item.setTitle(t('toolbar.loadView'))
                .setIcon('folder-open');

            const shortViewType = ViewSettingsMenu.toShortViewType(viewType);

            if (!folder) {
                item.setSubmenu().addItem((sub: MenuItem) =>
                    sub.setTitle(t('toolbar.noFolderConfigured')).setDisabled(true));
            } else {
                const loader = new ViewTemplateLoader(app);
                const summaries = loader.loadTemplates(folder)
                    .filter(s => s.viewType === shortViewType);

                const submenu = item.setSubmenu();
                if (summaries.length === 0) {
                    submenu.addItem((sub: MenuItem) =>
                        sub.setTitle(t('toolbar.noTemplatesFound')).setDisabled(true));
                } else {
                    for (const summary of summaries) {
                        submenu.addItem((sub: MenuItem) => {
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

        menu.addItem((item) => {
            item.setTitle(t('toolbar.resetView'))
                .setIcon('rotate-ccw')
                .onClick(() => onReset());
        });

        menu.addSeparator();

        menu.addItem((item) => {
            item.setTitle(t('toolbar.copyUri'))
                .setIcon('link')
                .onClick(async () => {
                    const uriOpts = buildUri();
                    uriOpts.position = ViewUriBuilder.detectLeafPosition(leaf, app.workspace);
                    uriOpts.name = getCustomName();

                    if (folder) {
                        uriOpts.template = getCustomName() || getDefaultName();
                    }

                    const uri = ViewUriBuilder.build(viewType, uriOpts);
                    await navigator.clipboard.writeText(uri);
                    new Notice(t('notice.uriCopied'));
                });
        });

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

        const descriptor = exportDescriptorFor(viewType);
        if (descriptor) {
            menu.addSeparator();

            menu.addItem((item) => {
                item.setTitle(t('toolbar.exportAsImage'))
                    .setIcon('image')
                    .onClick(async () => {
                        const contentEl = (leaf.view as any).contentEl as HTMLElement | undefined;
                        if (!contentEl) {
                            new Notice(t('notice.noContentToExport'));
                            return;
                        }
                        const container = resolveExportContainer(contentEl, descriptor);
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
                        const folder = options.getExportFolder?.()?.trim() || 'task-viewer-export';
                        await ViewExporter.exportAsPng({
                            app: options.app,
                            container,
                            filename,
                            folder,
                        }, descriptor.spec);
                    });
            });
        }

        menu.addSeparator();

        menu.addItem((item) => {
            item.setTitle(t('toolbar.position')).setDisabled(true);
        });

        const pos = ViewUriBuilder.detectLeafPosition(leaf, app.workspace);
        menu.addItem((item) => {
            item.setTitle(`  ${getPositionLabel(pos)}`)
                .setChecked(true)
                .setDisabled(true);
        });
    }

    private static toShortViewType(viewType: string): string {
        return viewType.replace(/-view$/, '');
    }
}
