import { setIcon, Notice } from 'obsidian';
import type { App, Menu, MenuItem, WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import { ViewUriBuilder, type LeafPosition, type ViewUriOptions } from '../sharedLogic/ViewUriBuilder';
import { shortNameFor } from '../../services/viewConfig';
import { InputModal } from '../../modals/InputModal';
import type { Task, ViewTemplate } from '../../types';
import type { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import { ViewTemplateLoader } from '../../services/template/ViewTemplateLoader';
import { ViewTemplateWriter } from '../../services/template/ViewTemplateWriter';
import { ViewExporter } from '../../services/export/ViewExporter';
import { exportDescriptorFor, resolveExportContainer } from '../../services/export/ExportRegistry';
import { buildExportFilename } from '../../services/export/ExportFilename';
import type { MenuPresenter } from '../../interaction/menu/MenuPresenter';
import { viewContentEl } from '../../utils/ObsidianView';

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
 * Days-per-screen choices. Declared once so the button's dropdown and the
 * compact "⋮" submenu cannot drift apart.
 */
const VIEW_MODE_VALUES: readonly number[] = [1, 3, 7];

/** Label for a days-per-screen value. */
function viewModeLabel(value: number): string {
    if (value === 1) return t('toolbar.viewMode1Day');
    if (value === 3) return t('toolbar.viewMode3Days');
    return t('toolbar.viewModeWeek');
}

/**
 * View mode selector (1 Day / 3 Days / Week).
 *
 * Returns an `update()` handle so external state changes (layout restore, URI
 * params, template apply) can refresh the label. Reads `getValue()` lazily on
 * every menu open so the checked item always reflects current state.
 */
export class ViewModeSelector {
    /**
     * Add one checkable item per view mode. Shared by the button's dropdown
     * and by {@link appendSubmenu}, so the option list has a single home.
     */
    static appendMenuItems(
        menu: Menu,
        getValue: () => number,
        onChange: (newValue: number) => void
    ): void {
        const current = getValue();
        for (const value of VIEW_MODE_VALUES) {
            menu.addItem((item: MenuItem) => {
                item.setTitle(viewModeLabel(value))
                    .setChecked(current === value)
                    .onClick(() => onChange(value));
            });
        }
    }

    /** Add the same choices as a labelled submenu (compact toolbar mode). */
    static appendSubmenu(
        menu: Menu,
        getValue: () => number,
        onChange: (newValue: number) => void
    ): void {
        menu.addItem((item: MenuItem) => {
            item.setTitle(t('toolbar.viewModeLabel', { label: viewModeLabel(getValue()) }));
            ViewModeSelector.appendMenuItems(item.setSubmenu(), getValue, onChange);
        });
    }

    static render(
        toolbar: HTMLElement,
        getValue: () => number,
        onChange: (newValue: number) => void,
        menuPresenter: MenuPresenter
    ): { update: () => void } {
        const button = toolbar.createEl('button', { cls: 'view-toolbar__btn--range view-toolbar__btn--view-mode' });
        const iconEl = button.createSpan('view-toolbar__btn-icon');
        const labelEl = button.createSpan({ cls: 'view-toolbar__btn-label' });
        setIcon(iconEl, 'chevrons-up-down');

        const update = () => {
            const label = viewModeLabel(getValue());
            labelEl.setText(label);
            button.setAttribute('aria-label', t('toolbar.viewModeLabel', { label }));
        };
        update();

        button.onclick = (e) => {
            menuPresenter.present((menu) => {
                ViewModeSelector.appendMenuItems(menu, getValue, (value) => {
                    onChange(value);
                    update();
                });
            }, { kind: 'position', x: e.pageX, y: e.pageY });
        };

        return { update };
    }
}

/**
 * Selectable zoom steps. Declared once so the button's dropdown and the
 * compact "⋮" submenu cannot drift apart.
 */
const ZOOM_LEVELS: readonly number[] = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0];

/** Percentage label for a zoom level (1.0 → "100%"). */
function zoomLabel(level: number): string {
    return `${Math.round(level * 100)}%`;
}

/**
 * Zoom selector for timeline scaling.
 */
export class ZoomSelector {
    /**
     * Add one checkable item per zoom step. Shared by the button's dropdown
     * and by {@link appendSubmenu}, so the option list has a single home.
     */
    static appendMenuItems(
        menu: Menu,
        getZoom: () => number,
        onZoomChange: (newZoom: number) => void
    ): void {
        const current = getZoom();
        for (const level of ZOOM_LEVELS) {
            menu.addItem((item: MenuItem) => {
                item.setTitle(zoomLabel(level))
                    .setChecked(current === level)
                    .onClick(() => onZoomChange(level));
            });
        }
    }

    /** Add the same steps as a labelled submenu (compact toolbar mode). */
    static appendSubmenu(
        menu: Menu,
        getZoom: () => number,
        onZoomChange: (newZoom: number) => void
    ): void {
        menu.addItem((item: MenuItem) => {
            item.setTitle(t('toolbar.zoomLabel', { pct: zoomLabel(getZoom()) }));
            ZoomSelector.appendMenuItems(item.setSubmenu(), getZoom, onZoomChange);
        });
    }

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
        onZoomChange: (newZoom: number) => void,
        menuPresenter: MenuPresenter
    ): { update: () => void } {
        const button = toolbar.createEl('button', { cls: 'view-toolbar__btn--range view-toolbar__btn--zoom' });
        const iconEl = button.createSpan('view-toolbar__btn-icon');
        const labelEl = button.createSpan({ cls: 'view-toolbar__btn-label' });
        setIcon(iconEl, 'chevrons-up-down');

        const update = () => {
            const pct = zoomLabel(getZoom());
            labelEl.setText(pct);
            button.setAttribute('aria-label', t('toolbar.zoomLabel', { pct }));
        };
        update();

        button.onclick = (e) => {
            menuPresenter.present((menu) => {
                ZoomSelector.appendMenuItems(menu, getZoom, (level) => {
                    onZoomChange(level);
                    update();
                });
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
 * The two entries every compact ("⋮") toolbar menu carries: open the filter
 * popover, and toggle mask mode. Timeline, Calendar and Schedule each used to
 * spell these out; the wording, icons and the "refresh the toolbar afterwards"
 * step now live here.
 */
export interface CompactMenuDeps {
    filterMenu: FilterMenuComponent;
    getTasks: () => Task[];
    getStartHour: () => number;
    onFilterChange: () => void;
    getMaskMode: () => boolean;
    setMaskMode: (next: boolean) => void;
    /** Called after either item acts — the toolbars pass their `update()`. */
    onAfter: () => void;
}

/** Append the filter + mask entries to a compact toolbar menu. */
export function appendCompactFilterAndMask(
    menu: Menu,
    anchorEl: HTMLElement,
    deps: CompactMenuDeps,
): void {
    menu.addItem((item: MenuItem) => {
        item.setTitle(t('toolbar.filter'))
            .setIcon('filter')
            .onClick(() => {
                deps.filterMenu.showMenuAtElement(anchorEl, {
                    onFilterChange: () => {
                        deps.onFilterChange();
                        deps.onAfter();
                    },
                    getTasks: () => deps.getTasks(),
                    getStartHour: () => deps.getStartHour(),
                });
            });
    });

    const maskOn = deps.getMaskMode();
    menu.addItem((item: MenuItem) => {
        item.setTitle(t('toolbar.maskMode'))
            .setIcon(maskOn ? 'eye-off' : 'eye')
            .setChecked(maskOn)
            .onClick(() => {
                deps.setMaskMode(!maskOn);
                deps.onAfter();
            });
    });
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
                        const contentEl = viewContentEl(leaf);
                        if (!contentEl) {
                            new Notice(t('notice.noContentToExport'));
                            return;
                        }
                        const container = resolveExportContainer(contentEl, descriptor);
                        if (!container) {
                            new Notice(t('notice.noContentToExport'));
                            return;
                        }
                        const label = getCustomName() || ViewSettingsMenu.toShortViewType(viewType);
                        const filename = buildExportFilename(label);
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

    /**
     * Short name for filenames and template lookups. Reads the schema rather
     * than stripping a `-view` suffix, which only worked as long as every view
     * type happened to end in one.
     */
    private static toShortViewType(viewType: string): string {
        return shortNameFor(viewType) ?? viewType;
    }
}
