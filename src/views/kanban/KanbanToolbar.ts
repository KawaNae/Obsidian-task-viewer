import { setIcon } from 'obsidian';
import { t } from '../../i18n';
import { ViewSettingsMenu, MaskToggleButton, ViewToolbarBase, editViewFilter } from '../sharedUI/ViewToolbar';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import { hasConditions } from '../../services/filter/FilterTypes';
import type { ViewToolbarHost } from '../base/TaskViewerView';
import type { KanbanState } from './KanbanSchema';

export interface KanbanToolbarDeps {
    host: ViewToolbarHost<KanbanState>;
}

/**
 * Persistent toolbar for KanbanView. It reads and writes the view's store
 * and mends itself when the store changes.
 */
export class KanbanToolbar extends ViewToolbarBase {
    private filterBtn: HTMLButtonElement | null = null;
    private maskHandle: { update: () => void } | null = null;
    private readonly filterMenu: FilterMenuComponent;

    constructor(private deps: KanbanToolbarDeps) {
        super();
        this.filterMenu = new FilterMenuComponent(deps.host.app.keymap);
        this.filterMenu.setStatusDefinitions(deps.host.plugin.settings.statusDefinitions);
        deps.host.store.subscribe(() => this.update());
    }

    private get store() {
        return this.deps.host.store;
    }

    /** Close the popovers the toolbar opened. */
    close(): void {
        this.filterMenu.close();
    }

    protected override buildDom(toolbar: HTMLElement): void {
        const { host } = this.deps;

        toolbar.createDiv('view-toolbar__spacer');

        const filterBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(filterBtn, 'filter');
        filterBtn.setAttribute('aria-label', t('toolbar.filter'));
        filterBtn.onclick = (event) => {
            editViewFilter(this.filterMenu, { event }, this.store, () => host.plugin.getIndex().getTasks());
        };
        this.filterBtn = filterBtn;

        this.maskHandle = MaskToggleButton.render(toolbar, {
            getMaskMode: () => this.store.get().maskMode ?? false,
            setMaskMode: (next) => this.store.update({ maskMode: next }),
        });

        ViewSettingsMenu.renderButton(toolbar, host.settingsOptions());
    }

    override update(): void {
        if (this.filterBtn) {
            const filterState = this.store.get().filterState;
            this.filterBtn.classList.toggle('is-filtered', !!filterState && hasConditions(filterState));
        }
        this.maskHandle?.update();
    }
}
