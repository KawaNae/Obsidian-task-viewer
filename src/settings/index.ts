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
import { TabStrip, type TabSpec } from '../views/sharedUI/TabStrip';

type SettingsTabId = 'basic' | 'general' | 'views' | 'viewDetails' | 'notes' | 'frontmatter' | 'parsers' | 'log' | 'about';

export class TaskViewerSettingTab extends PluginSettingTab {
    plugin: PluginContext;
    private activeTabId: SettingsTabId = 'basic';
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

        // The tabs: the strip builds the row and a pane for each, and keeps one
        // chosen; what each pane holds is drawn here. The tab last chosen is
        // kept for the next drawing (opened again, or drawn anew by a tab).
        const tabs: (TabSpec<SettingsTabId> & { render: (el: HTMLElement) => void })[] = [
            { id: 'basic',        label: t('settings.tabs.basic'),        render: (el) => BasicTab.render(el, this.plugin, fields) },
            { id: 'general',      label: t('settings.tabs.general'),      render: (el) => GeneralTab.render(el, this.plugin) },
            { id: 'views',        label: t('settings.tabs.views'),        render: (el) => ViewsTab.render(el, this.plugin, fields) },
            { id: 'viewDetails',  label: t('settings.tabs.viewDetails'),  render: (el) => ViewDetailsTab.render(el, this.plugin, fields) },
            { id: 'notes',        label: t('settings.tabs.notes'),        render: (el) => NotesTab.render(el, this.plugin, fields) },
            { id: 'frontmatter',  label: t('settings.tabs.frontmatter'),  render: (el) => FrontmatterTab.render(el, this.plugin, fields) },
            { id: 'parsers',      label: t('settings.tabs.parsers'),      render: (el) => ParsersTab.render(el, this.plugin, () => this.display()) },
            { id: 'log',          label: t('settings.tabs.log'),          render: (el) => LogTab.render(el, this.plugin, fields) },
            { id: 'about',        label: t('settings.tabs.about'),        render: (el) => AboutTab.render(el, this.plugin) },
        ];
        const strip = new TabStrip<SettingsTabId>(containerEl, tabs, {
            initial: this.activeTabId,
            onSelect: (id) => { this.activeTabId = id; },
        });
        for (const tab of tabs) tab.render(strip.pane(tab.id));
    }

    /** The tab is closed: what is typed in a field is committed, as a blur would, without waiting for one. */
    hide(): void {
        this.fields?.commitAll();
        this.fields = null;
        super.hide();
    }
}
