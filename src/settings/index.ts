import { type App, type Plugin, PluginSettingTab } from 'obsidian';
import type { PluginContext } from '../PluginContext';
import { t } from '../i18n';
import * as BasicTab from './BasicTab';
import * as GeneralTab from './GeneralTab';
import * as ViewsTab from './ViewsTab';
import * as ViewDetailsTab from './ViewDetailsTab';
import * as NotesTab from './NotesTab';
import * as FrontmatterTab from './FrontmatterTab';
import * as ParsersTab from './ParsersTab';
import * as LogTab from './LogTab';
import * as AboutTab from './AboutTab';
import { SettingFields } from './SettingFields';

export class TaskViewerSettingTab extends PluginSettingTab {
    plugin: PluginContext;
    private activeTabId = 'basic';
    /** The text fields of the tab as drawn now: what is typed in them is committed as it is hidden or drawn again. */
    private fields: SettingFields | null = null;

    // `PluginSettingTab` hands its own constructor argument to Obsidian, which
    // wants the real Plugin. The tab itself only ever reads PluginContext, so
    // the two are asked for separately rather than widening the field.
    constructor(app: App, plugin: PluginContext & Plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        this.fields?.commitAll();
        const fields = new SettingFields(this.plugin);
        this.fields = fields;
        containerEl.empty();
        containerEl.addClass('tv-settings');

        // Version display
        const versionEl = containerEl.createDiv('tv-settings__version');
        versionEl.createSpan({
            text: `Task Viewer v${this.plugin.manifest.version}`,
            cls: 'setting-item-description'
        });
        versionEl.createSpan({
            text: ` — Built: ${typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'unknown'}`,
            cls: 'setting-item-description'
        });

        // Tab UI
        const wrapper = containerEl.createDiv('tv-settings__wrapper');
        const nav = wrapper.createDiv('tv-settings__nav');
        const content = wrapper.createDiv('tv-settings__content');

        const tabs = [
            { id: 'basic',        label: t('settings.tabs.basic'),        render: (el: HTMLElement) => BasicTab.render(el, this.plugin, fields) },
            { id: 'general',      label: t('settings.tabs.general'),      render: (el: HTMLElement) => GeneralTab.render(el, this.plugin) },
            { id: 'views',        label: t('settings.tabs.views'),        render: (el: HTMLElement) => ViewsTab.render(el, this.plugin, fields) },
            { id: 'viewDetails',  label: t('settings.tabs.viewDetails'),  render: (el: HTMLElement) => ViewDetailsTab.render(el, this.plugin, fields) },
            { id: 'notes',        label: t('settings.tabs.notes'),        render: (el: HTMLElement) => NotesTab.render(el, this.plugin, fields) },
            { id: 'frontmatter',  label: t('settings.tabs.frontmatter'),  render: (el: HTMLElement) => FrontmatterTab.render(el, this.plugin, fields) },
            { id: 'parsers',      label: t('settings.tabs.parsers'),      render: (el: HTMLElement) => ParsersTab.render(el, this.plugin, () => this.display()) },
            { id: 'log',          label: t('settings.tabs.log'),          render: (el: HTMLElement) => LogTab.render(el, this.plugin, fields) },
            { id: 'about',        label: t('settings.tabs.about'),        render: (el: HTMLElement) => AboutTab.render(el, this.plugin) },
        ];

        tabs.forEach(tab => {
            const btn = nav.createEl('div', {
                cls: 'tv-settings__nav-btn',
                text: tab.label,
                attr: { role: 'tab', tabindex: '0' },
            });
            btn.dataset.tabId = tab.id;

            const panel = content.createDiv('tv-settings__panel');
            panel.dataset.tabId = tab.id;
            tab.render(panel);
        });

        const initialTab = tabs.some(tab => tab.id === this.activeTabId) ? this.activeTabId : tabs[0].id;
        this.activateTab(wrapper, initialTab);

        nav.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest('.tv-settings__nav-btn') as HTMLElement | null;
            if (btn?.dataset.tabId) {
                this.activateTab(wrapper, btn.dataset.tabId);
            }
        });
    }

    /** The tab is closed: what is typed in a field is committed, as a blur would, without waiting for one. */
    hide(): void {
        this.fields?.commitAll();
        this.fields = null;
        super.hide();
    }

    private activateTab(wrapper: HTMLElement, tabId: string): void {
        this.activeTabId = tabId;
        wrapper.querySelectorAll('.tv-settings__nav-btn').forEach(btn =>
            btn.toggleClass('tv-settings__nav-btn--active', (btn as HTMLElement).dataset.tabId === tabId)
        );
        wrapper.querySelectorAll('.tv-settings__panel').forEach(panel =>
            (panel as HTMLElement).style.display = (panel as HTMLElement).dataset.tabId === tabId ? '' : 'none'
        );
    }
}
