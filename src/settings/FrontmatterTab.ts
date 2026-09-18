import { Notice, Setting } from 'obsidian';
import type { PluginContext } from '../PluginContext';
import { type ScopeKeys, validateScopeKeys } from '../types';
import { t } from '../i18n';

export function render(el: HTMLElement, plugin: PluginContext): void {
    el.createEl('h3', { text: t('settings.frontmatter.frontmatterKeys'), cls: 'setting-section-header' });

    addScopeKeySettings(el, plugin);

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

function addScopeKeySettings(containerEl: HTMLElement, plugin: PluginContext): void {
    addScopeKeySetting(containerEl, plugin, t('settings.frontmatter.startKey'), t('settings.frontmatter.startKeyDesc'), 'tv-start', 'start');
    addScopeKeySetting(containerEl, plugin, t('settings.frontmatter.endKey'), t('settings.frontmatter.endKeyDesc'), 'tv-end', 'end');
    addScopeKeySetting(containerEl, plugin, t('settings.frontmatter.dueKey'), t('settings.frontmatter.dueKeyDesc'), 'tv-due', 'due');
    addScopeKeySetting(containerEl, plugin, t('settings.frontmatter.colorKey'), t('settings.frontmatter.colorKeyDesc'), 'tv-color', 'color');
    addScopeKeySetting(containerEl, plugin, t('settings.frontmatter.lineStyleKey'), t('settings.frontmatter.lineStyleKeyDesc'), 'tv-linestyle', 'linestyle');
    addScopeKeySetting(containerEl, plugin, t('settings.frontmatter.maskKey'), t('settings.frontmatter.maskKeyDesc'), 'tv-mask', 'mask');
    addScopeKeySetting(containerEl, plugin, t('settings.frontmatter.ignoreKey'), t('settings.frontmatter.ignoreKeyDesc'), 'tv-ignore', 'ignore');
}

function addScopeKeySetting(
    containerEl: HTMLElement,
    plugin: PluginContext,
    name: string,
    description: string,
    placeholder: string,
    key: keyof ScopeKeys
): void {
    new Setting(containerEl)
        .setName(name)
        .setDesc(description)
        .addText((text) => {
            text.setPlaceholder(placeholder);
            text.setValue(plugin.settings.scopeKeys[key]);
            text.onChange(async (value) => {
                const nextKeys: ScopeKeys = {
                    ...plugin.settings.scopeKeys,
                    [key]: value.trim(),
                };

                const error = validateScopeKeys(nextKeys);
                if (error) {
                    new Notice(error);
                    text.setValue(plugin.settings.scopeKeys[key]);
                    return;
                }

                plugin.settings.scopeKeys = nextKeys;
                await plugin.saveSettings();
            });
        });
}
