import { Setting } from 'obsidian';
import type { PluginContext } from '../PluginContext';
import { DEFAULT_SETTINGS, FIXED_STATUS_CHARS } from '../types';
import { t } from '../i18n';
import { FolderSuggest } from '../suggest/FolderSuggest';
import { SETTINGS_SCHEMA } from './SettingsSchema';
import type { SettingFields } from './SettingFields';
import { StatusCharInput } from '../services/parsing/utils/StatusCharInput';
import { FreeText } from '../utils/values/TextValues';

type FolderKey = 'viewTemplateFolder' | 'exportFolder' | 'intervalTemplateFolder';

export function render(el: HTMLElement, plugin: PluginContext, fields: SettingFields): void {
    // Time & Calendar (timezone settings will live here too)
    el.createEl('h3', { text: t('settings.basic.timeAndCalendar'), cls: 'setting-section-header' });

    fields.text(new Setting(el)
        .setName(t('settings.views.startHour'))
        .setDesc(t('settings.views.startHourDesc')), {
        codec: SETTINGS_SCHEMA.startHour.codec,
        get: () => plugin.settings.startHour,
        put: (hour) => { plugin.settings.startHour = hour; },
        placeholder: '5',
        inputMode: 'numeric',
    });

    new Setting(el)
        .setName(t('settings.views.weekStartsOn'))
        .setDesc(t('settings.views.weekStartsOnDesc'))
        .addDropdown(dropdown => dropdown
            .addOption('0', t('settings.views.sunday'))
            .addOption('1', t('settings.views.monday'))
            .setValue(String(plugin.settings.weekStartDay))
            .onChange(async (value) => {
                plugin.settings.weekStartDay = value === '1' ? 1 : 0;
                await plugin.saveSettings();
            }));

    // Latitude & Longitude
    el.createEl('h3', { text: t('settings.basic.latLon'), cls: 'setting-section-header' });

    // A text keyboard on a phone: a latitude or a longitude may be negative.
    const location = SETTINGS_SCHEMA.astronomy.fields.location.fields;
    fields.text(new Setting(el)
        .setName(t('settings.views.homeLatitude'))
        .setDesc(t('settings.views.homeLatitudeDesc')), {
        codec: location.latitude.codec,
        get: () => plugin.settings.astronomy.location.latitude,
        put: (n) => { plugin.settings.astronomy.location.latitude = n; },
        placeholder: '35.6762',
    });

    fields.text(new Setting(el)
        .setName(t('settings.views.homeLongitude'))
        .setDesc(t('settings.views.homeLongitudeDesc')), {
        codec: location.longitude.codec,
        get: () => plugin.settings.astronomy.location.longitude,
        put: (n) => { plugin.settings.astronomy.location.longitude = n; },
        placeholder: '139.6503',
    });

    // Checkbox Styles
    el.createEl('h3', { text: t('settings.basic.checkboxStyles'), cls: 'setting-section-header' });

    new Setting(el)
        .setName(t('settings.general.applyCustomCheckboxStyles'))
        .setDesc(t('settings.general.applyCustomCheckboxStylesDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.applyGlobalStyles)
            .onChange(async (value) => {
                plugin.settings.applyGlobalStyles = value;
                await plugin.saveSettings();
            }));

    // Status Definitions
    el.createEl('h3', { text: t('settings.general.statusDefinitions'), cls: 'setting-section-header' });
    const statusDesc = el.createDiv('setting-item');
    statusDesc.createSpan({ text: t('settings.general.statusDefinitionsDesc'), cls: 'setting-item-description' });

    const statusListContainer = el.createDiv('status-definitions-list-container');
    renderStatusDefinitionsList(statusListContainer, plugin, fields);

    new Setting(el)
        .setName(t('settings.general.addStatus'))
        .setDesc(t('settings.general.addStatusDesc'))
        .addButton(btn => btn
            .setButtonText(t('settings.general.addButton'))
            .onClick(async () => {
                plugin.settings.statusDefinitions.push({ char: '', label: '', isComplete: false });
                await plugin.saveSettings();
                renderStatusDefinitionsList(statusListContainer, plugin, fields);
            })
        );

    // Templates
    el.createEl('h3', { text: t('settings.views.templates'), cls: 'setting-section-header' });

    const folder = (setting: Setting, key: FolderKey, shown: { placeholder: string }) => fields.text(setting, {
        codec: SETTINGS_SCHEMA[key].codec,
        get: () => plugin.settings[key],
        put: (path) => { plugin.settings[key] = path; },
        placeholder: shown.placeholder,
        list: (input, picked) => new FolderSuggest(plugin.app, input, (f) => picked(f.path)),
    });

    folder(new Setting(el)
        .setName(t('settings.views.viewTemplateFolder'))
        .setDesc(t('settings.views.viewTemplateFolderDesc')), 'viewTemplateFolder', { placeholder: 'Templates/Views' });

    folder(new Setting(el)
        .setName(t('settings.views.exportFolder'))
        .setDesc(t('settings.views.exportFolderDesc', { folder: DEFAULT_SETTINGS.exportFolder })), 'exportFolder', { placeholder: DEFAULT_SETTINGS.exportFolder });

    folder(new Setting(el)
        .setName(t('settings.views.intervalTemplateFolder'))
        .setDesc(t('settings.views.intervalTemplateFolderDesc')), 'intervalTemplateFolder', { placeholder: 'Templates/Timers' });
}

function renderStatusDefinitionsList(container: HTMLElement, plugin: PluginContext, fields: SettingFields): void {
    container.empty();
    const fixedChars = new Set<string>(FIXED_STATUS_CHARS as unknown as string[]);
    const defs = plugin.settings.statusDefinitions;

    defs.forEach((def, i) => {
        const isFixed = fixedChars.has(def.char);

        const setting = new Setting(container);

        const previewCheckbox = document.createElement('input');
        previewCheckbox.type = 'checkbox';
        previewCheckbox.classList.add('task-list-item-checkbox');
        previewCheckbox.checked = def.char !== ' ';
        previewCheckbox.readOnly = true;
        previewCheckbox.tabIndex = -1;
        previewCheckbox.style.pointerEvents = 'none';
        if (def.char && def.char !== ' ') {
            previewCheckbox.setAttribute('data-task', def.char);
        }
        setting.nameEl.empty();
        setting.nameEl.appendChild(previewCheckbox);

        // A character none of the other statuses has, read as typed (a space is one).
        // The status is held by itself, not by its place, which a move changes.
        const { input: charInput } = fields.text(setting, {
            codec: StatusCharInput.codec(() => defs.filter(d => d !== def).map(d => d.char)),
            get: () => def.char,
            put: (c) => { def.char = c; },
            placeholder: t('settings.general.statusCharPlaceholder'),
            saved: (c) => {
                previewCheckbox.checked = c !== ' ';
                if (c !== ' ') previewCheckbox.setAttribute('data-task', c);
                else previewCheckbox.removeAttribute('data-task');
            },
        });
        charInput.maxLength = 1;
        charInput.addClass('tv-settings__status-char');
        if (isFixed) charInput.readOnly = true;

        fields.text(setting, {
            codec: FreeText,
            get: () => def.label,
            put: (label) => { def.label = label; },
            placeholder: t('settings.general.statusLabelPlaceholder'),
        }).input.addClass('tv-settings__status-name');

        setting.addToggle(toggle => {
            // A blank status is fixed to incomplete in isCompleteStatusChar
            // (TaskModel.ts) no matter what this setting says, so the toggle
            // would otherwise look live while doing nothing. Disable it and
            // show the value that is actually in effect, rather than
            // whatever a stale `data.json` happens to hold.
            const isBlank = def.char === ' ';
            toggle.setValue(isBlank ? false : def.isComplete)
                .setDisabled(isBlank)
                .onChange(async (value) => {
                    defs[i].isComplete = value;
                    await plugin.saveSettings();
                });
            toggle.toggleEl.title = t('settings.general.isCompleteTooltip');
        });

        setting.addExtraButton(btn => {
            btn.setIcon('chevron-up').setTooltip(t('menu.moveUp'));
            if (i === 0) {
                btn.setDisabled(true);
                btn.extraSettingsEl.style.opacity = '0.2';
            }
            btn.onClick(async () => {
                [defs[i], defs[i - 1]] = [defs[i - 1], defs[i]];
                await plugin.saveSettings();
                renderStatusDefinitionsList(container, plugin, fields);
            });
        });

        setting.addExtraButton(btn => {
            btn.setIcon('chevron-down').setTooltip(t('menu.moveDown'));
            if (i === defs.length - 1) {
                btn.setDisabled(true);
                btn.extraSettingsEl.style.opacity = '0.2';
            }
            btn.onClick(async () => {
                [defs[i], defs[i + 1]] = [defs[i + 1], defs[i]];
                await plugin.saveSettings();
                renderStatusDefinitionsList(container, plugin, fields);
            });
        });

        setting.addExtraButton(btn => {
            btn.setIcon('trash').setTooltip(t('settings.general.removeStatus'));
            if (isFixed) {
                btn.setDisabled(true);
                btn.extraSettingsEl.style.opacity = '0.2';
                btn.extraSettingsEl.style.cursor = 'default';
            } else {
                btn.onClick(async () => {
                    defs.splice(i, 1);
                    await plugin.saveSettings();
                    renderStatusDefinitionsList(container, plugin, fields);
                });
            }
        });
    });
}
