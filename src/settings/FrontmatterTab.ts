import { Notice, Setting } from 'obsidian';
import TaskViewerPlugin from '../main';
import { TvFileKeys, validateTvFileKeys } from '../types';
import { t } from '../i18n';

export function render(el: HTMLElement, plugin: TaskViewerPlugin): void {
    el.createEl('h3', { text: t('settings.frontmatter.frontmatterKeys'), cls: 'setting-section-header' });

    addFrontmatterTaskKeySettings(el, plugin);

    el.createEl('h3', { text: t('settings.frontmatter.suggest'), cls: 'setting-section-header' });

    new Setting(el)
        .setDesc(t('settings.frontmatter.suggestReloadNotice'))
        .setClass('setting-item--desc-only');

    new Setting(el)
        .setName(t('settings.frontmatter.colorSuggest'))
        .setDesc(t('settings.frontmatter.colorSuggestDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.suggestColor)
            .onChange(async (value) => {
                plugin.settings.suggestColor = value;
                await plugin.saveSettings();
            }));

    new Setting(el)
        .setName(t('settings.frontmatter.lineStyleSuggest'))
        .setDesc(t('settings.frontmatter.lineStyleSuggestDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.suggestLinestyle)
            .onChange(async (value) => {
                plugin.settings.suggestLinestyle = value;
                await plugin.saveSettings();
            }));
}

function addFrontmatterTaskKeySettings(containerEl: HTMLElement, plugin: TaskViewerPlugin): void {
    addFrontmatterTaskKeySetting(containerEl, plugin, t('settings.frontmatter.startKey'), t('settings.frontmatter.startKeyDesc'), 'tv-start', 'start');
    addFrontmatterTaskKeySetting(containerEl, plugin, t('settings.frontmatter.endKey'), t('settings.frontmatter.endKeyDesc'), 'tv-end', 'end');
    addFrontmatterTaskKeySetting(containerEl, plugin, t('settings.frontmatter.dueKey'), t('settings.frontmatter.dueKeyDesc'), 'tv-due', 'due');
    addFrontmatterTaskKeySetting(containerEl, plugin, t('settings.frontmatter.statusKey'), t('settings.frontmatter.statusKeyDesc'), 'tv-status', 'status');
    addFrontmatterTaskKeySetting(containerEl, plugin, t('settings.frontmatter.contentKey'), t('settings.frontmatter.contentKeyDesc'), 'tv-content', 'content');
    addFrontmatterTaskKeySetting(containerEl, plugin, t('settings.frontmatter.timerTargetIdKey'), t('settings.frontmatter.timerTargetIdKeyDesc'), 'tv-timer-target-id', 'timerTargetId');
    addFrontmatterTaskKeySetting(containerEl, plugin, t('settings.frontmatter.colorKey'), t('settings.frontmatter.colorKeyDesc'), 'tv-color', 'color');
    addFrontmatterTaskKeySetting(containerEl, plugin, t('settings.frontmatter.lineStyleKey'), t('settings.frontmatter.lineStyleKeyDesc'), 'tv-linestyle', 'linestyle');
    addFrontmatterTaskKeySetting(containerEl, plugin, t('settings.frontmatter.maskKey'), t('settings.frontmatter.maskKeyDesc'), 'tv-mask', 'mask');
    addFrontmatterTaskKeySetting(containerEl, plugin, t('settings.frontmatter.ignoreKey'), t('settings.frontmatter.ignoreKeyDesc'), 'tv-ignore', 'ignore');
}

function addFrontmatterTaskKeySetting(
    containerEl: HTMLElement,
    plugin: TaskViewerPlugin,
    name: string,
    description: string,
    placeholder: string,
    key: keyof TvFileKeys
): void {
    new Setting(containerEl)
        .setName(name)
        .setDesc(description)
        .addText((text) => {
            text.setPlaceholder(placeholder);
            text.setValue(plugin.settings.tvFileKeys[key]);
            text.onChange(async (value) => {
                const nextKeys: TvFileKeys = {
                    ...plugin.settings.tvFileKeys,
                    [key]: value.trim(),
                };

                const error = validateTvFileKeys(nextKeys);
                if (error) {
                    new Notice(error);
                    text.setValue(plugin.settings.tvFileKeys[key]);
                    return;
                }

                plugin.settings.tvFileKeys = nextKeys;
                await plugin.saveSettings();
            });
        });
}
