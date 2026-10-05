import { Setting } from 'obsidian';
import type { PluginContext } from '../PluginContext';
import { DEFAULT_SCOPE_KEYS, type ScopeKeys } from '../types';
import { t } from '../i18n';
import { ScopeKeyInput } from '../services/parsing/utils/PropertyKeyInput';
import type { SettingFields } from './SettingFields';

export function render(el: HTMLElement, plugin: PluginContext, fields: SettingFields): void {
    el.createEl('h3', { text: t('settings.frontmatter.frontmatterKeys'), cls: 'setting-section-header' });

    addScopeKeySettings(el, plugin, fields);

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

function addScopeKeySettings(containerEl: HTMLElement, plugin: PluginContext, fields: SettingFields): void {
    const keys: { key: keyof ScopeKeys; name: string; desc: string }[] = [
        { key: 'start', name: t('settings.frontmatter.startKey'), desc: t('settings.frontmatter.startKeyDesc') },
        { key: 'end', name: t('settings.frontmatter.endKey'), desc: t('settings.frontmatter.endKeyDesc') },
        { key: 'due', name: t('settings.frontmatter.dueKey'), desc: t('settings.frontmatter.dueKeyDesc') },
        { key: 'color', name: t('settings.frontmatter.colorKey'), desc: t('settings.frontmatter.colorKeyDesc') },
        { key: 'linestyle', name: t('settings.frontmatter.lineStyleKey'), desc: t('settings.frontmatter.lineStyleKeyDesc') },
        { key: 'mask', name: t('settings.frontmatter.maskKey'), desc: t('settings.frontmatter.maskKeyDesc') },
        { key: 'ignore', name: t('settings.frontmatter.ignoreKey'), desc: t('settings.frontmatter.ignoreKeyDesc') },
    ];
    for (const { key, name, desc } of keys) {
        // Read as typed and committed once (a blur, the form's Enter): the notes
        // are read again for a key committed, not for each key typed (I#11).
        fields.text(new Setting(containerEl).setName(name).setDesc(desc), {
            codec: ScopeKeyInput.codec(() => keys.filter(other => other.key !== key).map(other => plugin.settings.scopeKeys[other.key])),
            get: () => plugin.settings.scopeKeys[key],
            put: (value) => { plugin.settings.scopeKeys = { ...plugin.settings.scopeKeys, [key]: value }; },
            placeholder: DEFAULT_SCOPE_KEYS[key],
        });
    }
}
