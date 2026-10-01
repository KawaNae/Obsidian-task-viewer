import { Notice, Setting } from 'obsidian';
import type { PluginContext } from '../PluginContext';
import { t } from '../i18n';
import { F } from '../services/viewConfig/FieldCodecs';

// The number fields read a whole decimal number in range, as the CLI's do
// (`F.int`). What is not one (empty, `3days`, out of range) is not saved:
// the setting keeps its value rather than taking a default or the range's
// end, so an emptied storage limit no longer saves 0, which is no limit.
/** Days the log is kept: one or more. */
const RETENTION_DAYS = F.int('logRetentionDays', { min: 1 });
/** Megabytes the log may take: 0 is no limit. */
const MAX_STORAGE_MB = F.int('logMaxStorageMB', { min: 0 });

export function render(el: HTMLElement, plugin: PluginContext): void {
    new Setting(el)
        .setName(t('settings.log.verboseNotice'))
        .setDesc(t('settings.log.verboseNoticeDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.verboseNotice)
            .onChange(async (value) => {
                plugin.settings.verboseNotice = value;
                await plugin.saveSettings();
            }));

    new Setting(el)
        .setName(t('settings.log.logRetention'))
        .setDesc(t('settings.log.logRetentionDesc'))
        .addText(text => text
            .setPlaceholder('7')
            .setValue(plugin.settings.logRetentionDays.toString())
            .onChange(async (value) => {
                const days = RETENTION_DAYS.parse(value.trim());
                if (days === undefined) return;
                plugin.settings.logRetentionDays = days;
                await plugin.saveSettings();
            }));

    new Setting(el)
        .setName(t('settings.log.maxStorage'))
        .setDesc(t('settings.log.maxStorageDesc'))
        .addText(text => text
            .setPlaceholder('50')
            .setValue(plugin.settings.logMaxStorageMB.toString())
            .onChange(async (value) => {
                const mb = MAX_STORAGE_MB.parse(value.trim());
                if (mb === undefined) return;
                plugin.settings.logMaxStorageMB = mb;
                await plugin.saveSettings();
            }));

    // Buffer stats
    el.createEl('h3', { text: t('settings.log.logBuffer'), cls: 'setting-section-header' });

    const statsEl = el.createDiv({ cls: 'setting-item-description' });
    statsEl.textContent = '...';

    const logManager = plugin.getLogManager();
    if (logManager) {
        void logManager.getStats().then(stats => {
            if (stats.count === 0) {
                statsEl.textContent = t('settings.log.bufferEmpty');
            } else {
                const sizeMB = (stats.approxBytes / (1024 * 1024)).toFixed(2);
                const oldest = stats.oldestTs ? new Date(stats.oldestTs).toLocaleDateString() : '?';
                const newest = stats.newestTs ? new Date(stats.newestTs).toLocaleDateString() : '?';
                statsEl.textContent = t('settings.log.bufferStats', {
                    count: stats.count,
                    size: `${sizeMB} MB`,
                    range: `${oldest} — ${newest}`,
                });
            }
        });
    }

    // Export
    new Setting(el)
        .setName(t('settings.log.exportLogs'))
        .setDesc(t('settings.log.exportLogsDesc'))
        .addButton(btn => btn
            .setButtonText(t('settings.log.exportLogs'))
            .onClick(async () => {
                if (!logManager) return;
                try {
                    const result = await logManager.exportToVault();
                    new Notice(t('settings.log.exportSuccess', {
                        count: result.count,
                        path: result.path,
                    }));
                } catch (e: any) {
                    new Notice(t('settings.log.exportFailed', { error: String(e?.message ?? e) }));
                }
            }));

    // Clear
    new Setting(el)
        .setName(t('settings.log.clearLogs'))
        .setDesc(t('settings.log.clearLogsDesc'))
        .addButton(btn => btn
            .setButtonText(t('settings.log.clearLogs'))
            .setWarning()
            .onClick(async () => {
                if (!logManager) return;
                if (!confirm(t('settings.log.clearLogsConfirm'))) return;
                await logManager.clearStoredLogs();
                new Notice(t('settings.log.cleared'));
            }));

    // Delete database
    new Setting(el)
        .setName(t('settings.log.deleteDatabase'))
        .setDesc(t('settings.log.deleteDatabaseDesc'))
        .addButton(btn => btn
            .setButtonText(t('settings.log.deleteDatabase'))
            .setWarning()
            .onClick(async () => {
                if (!logManager) return;
                if (!confirm(t('settings.log.deleteDatabaseConfirm'))) return;
                await logManager.deleteLogDatabase();
                new Notice(t('settings.log.deleted'));
            }));
}
