import { describe, it, expect, vi, afterEach } from 'vitest';
import { Setting } from 'obsidian';
import { render } from '../../../src/settings/LogTab';

/**
 * The log tab's number fields. A value that is not one (empty, not a whole
 * number, out of range) is not saved: the setting keeps what it had, and is
 * not replaced by a default or the range's end (the input decision E,
 * 2026-10-01).
 */

type Change = (value: string) => Promise<void>;

afterEach(() => {
    vi.restoreAllMocks();
});

function open(settings: { logRetentionDays: number; logMaxStorageMB: number }) {
    const changes: Change[] = [];
    vi.spyOn(Setting.prototype, 'addText').mockImplementation(function (this: Setting, cb: (text: unknown) => void) {
        const text = {
            setPlaceholder: () => text,
            setValue: () => text,
            onChange: (handler: Change) => { changes.push(handler); return text; },
        };
        cb(text);
        return this;
    });
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const plugin = {
        settings: { verboseNotice: false, ...settings },
        saveSettings,
        getLogManager: () => null,
    };
    const el = { createEl: () => ({}), createDiv: () => ({}) };
    render(el as never, plugin as never);
    const [retention, maxStorage] = changes;
    return { plugin, saveSettings, retention, maxStorage };
}

describe('the log retention field', () => {
    it.each(['3', ' 3 '])('saves %j as 3 days', async (typed) => {
        const { plugin, saveSettings, retention } = open({ logRetentionDays: 7, logMaxStorageMB: 50 });
        await retention(typed);
        expect(plugin.settings.logRetentionDays).toBe(3);
        expect(saveSettings).toHaveBeenCalledTimes(1);
    });

    it.each(['', 'abc', '0', '-1', '1.5', '3days', '0x10'])('does not save %j', async (typed) => {
        const { plugin, saveSettings, retention } = open({ logRetentionDays: 7, logMaxStorageMB: 50 });
        await retention(typed);
        expect(plugin.settings.logRetentionDays).toBe(7);
        expect(saveSettings).not.toHaveBeenCalled();
    });
});

describe('the log storage limit field', () => {
    it.each([['20', 20], ['0', 0]])('saves %j as %d MB (0 is no limit)', async (typed, mb) => {
        const { plugin, saveSettings, maxStorage } = open({ logRetentionDays: 7, logMaxStorageMB: 50 });
        await maxStorage(typed);
        expect(plugin.settings.logMaxStorageMB).toBe(mb);
        expect(saveSettings).toHaveBeenCalledTimes(1);
    });

    // An emptied field used to save 0, which lifts the limit.
    it.each(['', 'abc', '-1', '1.5', '10MB'])('does not save %j', async (typed) => {
        const { plugin, saveSettings, maxStorage } = open({ logRetentionDays: 7, logMaxStorageMB: 50 });
        await maxStorage(typed);
        expect(plugin.settings.logMaxStorageMB).toBe(50);
        expect(saveSettings).not.toHaveBeenCalled();
    });
});
