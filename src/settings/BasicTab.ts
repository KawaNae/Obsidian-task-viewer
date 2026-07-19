import { Setting } from 'obsidian';
import type TaskViewerPlugin from '../main';
import { FIXED_STATUS_CHARS } from '../types';
import { t } from '../i18n';
import { FolderSuggest } from '../suggest/FolderSuggest';

export function render(el: HTMLElement, plugin: TaskViewerPlugin): void {
    // Time & Calendar (timezone settings will live here too)
    el.createEl('h3', { text: t('settings.basic.timeAndCalendar'), cls: 'setting-section-header' });

    new Setting(el)
        .setName(t('settings.views.startHour'))
        .setDesc(t('settings.views.startHourDesc'))
        .addText(text => text
            .setPlaceholder('5')
            .setValue(plugin.settings.startHour.toString())
            .onChange(async (value) => {
                let hour = parseInt(value);
                if (isNaN(hour)) hour = 0;
                if (hour < 0) hour = 0;
                if (hour > 23) hour = 23;
                plugin.settings.startHour = hour;
                await plugin.saveSettings();
            }));

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

    new Setting(el)
        .setName(t('settings.views.homeLatitude'))
        .setDesc(t('settings.views.homeLatitudeDesc'))
        .addText(text => {
            text.inputEl.type = 'number';
            text.inputEl.step = 'any';
            text
                .setPlaceholder('35.6762')
                .setValue(String(plugin.settings.astronomy.location.latitude))
                .onChange(async (value) => {
                    let n = parseFloat(value);
                    if (isNaN(n)) return;
                    if (n < -90) n = -90;
                    if (n > 90) n = 90;
                    plugin.settings.astronomy.location.latitude = n;
                    await plugin.saveSettings();
                });
        });

    new Setting(el)
        .setName(t('settings.views.homeLongitude'))
        .setDesc(t('settings.views.homeLongitudeDesc'))
        .addText(text => {
            text.inputEl.type = 'number';
            text.inputEl.step = 'any';
            text
                .setPlaceholder('139.6503')
                .setValue(String(plugin.settings.astronomy.location.longitude))
                .onChange(async (value) => {
                    let n = parseFloat(value);
                    if (isNaN(n)) return;
                    if (n < -180) n = -180;
                    if (n > 180) n = 180;
                    plugin.settings.astronomy.location.longitude = n;
                    await plugin.saveSettings();
                });
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
                plugin.updateGlobalStyles();
            }));

    // Status Definitions
    el.createEl('h3', { text: t('settings.general.statusDefinitions'), cls: 'setting-section-header' });
    const statusDesc = el.createDiv('setting-item');
    statusDesc.createSpan({ text: t('settings.general.statusDefinitionsDesc'), cls: 'setting-item-description' });

    const statusListContainer = el.createDiv('status-definitions-list-container');
    renderStatusDefinitionsList(statusListContainer, plugin);

    new Setting(el)
        .setName(t('settings.general.addStatus'))
        .setDesc(t('settings.general.addStatusDesc'))
        .addButton(btn => btn
            .setButtonText(t('settings.general.addButton'))
            .onClick(async () => {
                plugin.settings.statusDefinitions.push({ char: '', label: '', isComplete: false });
                await plugin.saveSettings();
                renderStatusDefinitionsList(statusListContainer, plugin);
            })
        );

    // Templates
    el.createEl('h3', { text: t('settings.views.templates'), cls: 'setting-section-header' });

    new Setting(el)
        .setName(t('settings.views.viewTemplateFolder'))
        .setDesc(t('settings.views.viewTemplateFolderDesc'))
        .addText(text => {
            text.setPlaceholder('Templates/Views')
                .setValue(plugin.settings.viewTemplateFolder)
                .onChange(async (value) => {
                    plugin.settings.viewTemplateFolder = value.trim();
                    await plugin.saveSettings();
                });
            new FolderSuggest(plugin.app, text.inputEl);
        });

    new Setting(el)
        .setName(t('settings.views.exportFolder'))
        .setDesc(t('settings.views.exportFolderDesc'))
        .addText(text => {
            text.setPlaceholder('task-viewer-export')
                .setValue(plugin.settings.exportFolder)
                .onChange(async (value) => {
                    plugin.settings.exportFolder = value.trim();
                    await plugin.saveSettings();
                });
            new FolderSuggest(plugin.app, text.inputEl);
        });

    new Setting(el)
        .setName(t('settings.views.intervalTemplateFolder'))
        .setDesc(t('settings.views.intervalTemplateFolderDesc'))
        .addText(text => {
            text.setPlaceholder('Templates/Timers')
                .setValue(plugin.settings.intervalTemplateFolder)
                .onChange(async (value) => {
                    plugin.settings.intervalTemplateFolder = value.trim();
                    await plugin.saveSettings();
                });
            new FolderSuggest(plugin.app, text.inputEl);
        });
}

function renderStatusDefinitionsList(container: HTMLElement, plugin: TaskViewerPlugin): void {
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

        setting.addText(text => {
            text.setPlaceholder(t('settings.general.statusCharPlaceholder'))
                .setValue(def.char)
                .onChange(async (value) => {
                    const c = value.slice(0, 1);
                    if (c && defs.some((d, j) => j !== i && d.char === c)) {
                        text.setValue(def.char);
                        return;
                    }
                    defs[i].char = c;
                    await plugin.saveSettings();
                    previewCheckbox.checked = c !== ' ';
                    if (c && c !== ' ') {
                        previewCheckbox.setAttribute('data-task', c);
                    } else {
                        previewCheckbox.removeAttribute('data-task');
                    }
                });
            text.inputEl.maxLength = 1;
            text.inputEl.addClass('tv-settings__status-char');
            if (isFixed) text.inputEl.readOnly = true;
        });

        setting.addText(text => {
            text.setPlaceholder(t('settings.general.statusLabelPlaceholder'))
                .setValue(def.label)
                .onChange(async (value) => {
                    defs[i].label = value;
                    await plugin.saveSettings();
                });
            text.inputEl.addClass('tv-settings__status-name');
        });

        setting.addToggle(toggle => {
            toggle.setValue(def.isComplete)
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
                renderStatusDefinitionsList(container, plugin);
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
                renderStatusDefinitionsList(container, plugin);
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
                    renderStatusDefinitionsList(container, plugin);
                });
            }
        });
    });
}
