import { App, PluginSettingTab } from 'obsidian';
import TaskViewerPlugin from '../main';
import { t } from '../i18n';
import * as GeneralTab from './GeneralTab';
import * as ViewsTab from './ViewsTab';
import * as ViewDetailsTab from './ViewDetailsTab';
import * as NotesTab from './NotesTab';
import * as FrontmatterTab from './FrontmatterTab';
import * as HabitsTab from './HabitsTab';
import * as ParsersTab from './ParsersTab';

export class TaskViewerSettingTab extends PluginSettingTab {
    plugin: TaskViewerPlugin;

    constructor(app: App, plugin: TaskViewerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
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
            { id: 'general',      label: t('settings.tabs.general'),      render: (el: HTMLElement) => GeneralTab.render(el, this.plugin) },
            { id: 'views',        label: t('settings.tabs.views'),        render: (el: HTMLElement) => ViewsTab.render(el, this.plugin) },
            { id: 'viewDetails',  label: t('settings.tabs.viewDetails'),  render: (el: HTMLElement) => ViewDetailsTab.render(el, this.plugin) },
            { id: 'notes',        label: t('settings.tabs.notes'),        render: (el: HTMLElement) => NotesTab.render(el, this.plugin) },
            { id: 'frontmatter',  label: t('settings.tabs.frontmatter'),  render: (el: HTMLElement) => FrontmatterTab.render(el, this.plugin) },
            { id: 'habits',       label: t('settings.tabs.habits'),       render: (el: HTMLElement) => HabitsTab.render(el, this.plugin) },
            { id: 'parsers',      label: t('settings.tabs.parsers'),      render: (el: HTMLElement) => ParsersTab.render(el, this.plugin, () => this.display()) },
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

        this.activateTab(wrapper, tabs[0].id);

        nav.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest('.tv-settings__nav-btn') as HTMLElement | null;
            if (btn?.dataset.tabId) {
                this.activateTab(wrapper, btn.dataset.tabId);
            }
        });
    }

    private activateTab(wrapper: HTMLElement, tabId: string): void {
        wrapper.querySelectorAll('.tv-settings__nav-btn').forEach(btn =>
            btn.toggleClass('tv-settings__nav-btn--active', (btn as HTMLElement).dataset.tabId === tabId)
        );
        wrapper.querySelectorAll('.tv-settings__panel').forEach(panel =>
            (panel as HTMLElement).style.display = (panel as HTMLElement).dataset.tabId === tabId ? '' : 'none'
        );
    }
}
