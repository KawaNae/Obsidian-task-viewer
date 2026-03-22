import { Notice, Setting } from 'obsidian';
import TaskViewerPlugin from '../main';
import { FIXED_STATUS_CHARS } from '../types';
import { t } from '../i18n';

export function render(el: HTMLElement, plugin: TaskViewerPlugin): void {
    // Editor
    el.createEl('h3', { text: t('settings.general.editor'), cls: 'setting-section-header' });

    new Setting(el)
        .setName(t('settings.general.showEditorMenuForTasks'))
        .setDesc(t('settings.general.showEditorMenuForTasksDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.editorMenuForTasks)
            .onChange(async (value) => {
                plugin.settings.editorMenuForTasks = value;
                await plugin.saveSettings();
                plugin.notifyEditorMenuSettingsChanged();
            }));

    new Setting(el)
        .setName(t('settings.general.showEditorMenuForCheckboxes'))
        .setDesc(t('settings.general.showEditorMenuForCheckboxesDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.editorMenuForCheckboxes)
            .onChange(async (value) => {
                plugin.settings.editorMenuForCheckboxes = value;
                await plugin.saveSettings();
                plugin.notifyEditorMenuSettingsChanged();
            }));

    // Checkboxes
    el.createEl('h3', { text: t('settings.general.checkboxes'), cls: 'setting-section-header' });

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

    new Setting(el)
        .setName(t('settings.general.enableStatusMenu'))
        .setDesc(t('settings.general.enableStatusMenuDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.enableStatusMenu)
            .onChange(async (value) => {
                plugin.settings.enableStatusMenu = value;
                await plugin.saveSettings();
            }));

    // Status Definitions
    el.createEl('h4', { text: t('settings.general.statusDefinitions') });
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
}

function renderStatusDefinitionsList(container: HTMLElement, plugin: TaskViewerPlugin): void {
    container.empty();
    const fixedChars = new Set<string>(FIXED_STATUS_CHARS as unknown as string[]);
    const defs = plugin.settings.statusDefinitions;

    defs.forEach((def, i) => {
        const isFixed = fixedChars.has(def.char);

        const setting = new Setting(container);

        // Checkbox preview in nameEl
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

        // Char input
        setting.addText(text => {
            text.setPlaceholder(t('settings.general.statusCharPlaceholder'))
                .setValue(def.char)
                .onChange(async (value) => {
                    const c = value.slice(0, 1);
                    // Check for duplicates
                    if (c && defs.some((d, j) => j !== i && d.char === c)) {
                        text.setValue(def.char);
                        return;
                    }
                    defs[i].char = c;
                    await plugin.saveSettings();
                    // Update preview
                    previewCheckbox.checked = c !== ' ';
                    if (c && c !== ' ') {
                        previewCheckbox.setAttribute('data-task', c);
                    } else {
                        previewCheckbox.removeAttribute('data-task');
                    }
                });
            text.inputEl.maxLength = 1;
            text.inputEl.style.width = '3em';
            text.inputEl.style.textAlign = 'center';
            if (isFixed) text.inputEl.readOnly = true;
        });

        // Label input
        setting.addText(text => text
            .setPlaceholder(t('settings.general.statusLabelPlaceholder'))
            .setValue(def.label)
            .onChange(async (value) => {
                defs[i].label = value;
                await plugin.saveSettings();
            })
        );

        // Complete toggle with tooltip
        setting.addToggle(toggle => {
            toggle.setValue(def.isComplete)
                .onChange(async (value) => {
                    defs[i].isComplete = value;
                    await plugin.saveSettings();
                });
            toggle.toggleEl.title = t('settings.general.isCompleteTooltip');
        });

        // Move up button
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

        // Move down button
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

        // Trash button (disabled for fixed entries)
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
