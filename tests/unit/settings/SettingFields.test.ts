import { describe, it, expect, vi } from 'vitest';
import { SettingFields } from '../../../src/settings/SettingFields';
import { render as renderLogTab } from '../../../src/settings/LogTab';
import { SETTINGS_SCHEMA } from '../../../src/settings/SettingsSchema';
import { FakeEl, asEl } from '../helpers/fakeDom';

/**
 * The settings' text fields (I#11): read as typed, said under the
 * description, committed once by a blur or the form's Enter, and saved only
 * when what is typed reads (入力の論点 E).
 */

/** A setting as `SettingFields` uses it: a description, and the text fields it adds. */
class FakeSetting {
    readonly descEl = new FakeEl();
    readonly inputs: (FakeEl & { isConnected: boolean })[] = [];
    addText(cb: (text: unknown) => void): this {
        const input = Object.assign(new FakeEl(), { isConnected: true });
        this.inputs.push(input);
        cb({ inputEl: asEl(input), setPlaceholder: () => undefined });
        return this;
    }
    /** What the setting says under its description. */
    says(): string[] {
        return this.descEl.children.flatMap(el => el.lines());
    }
}

function hourField(initial = 5) {
    const settings = { startHour: initial };
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const fields = new SettingFields({ saveSettings });
    const setting = new FakeSetting();
    fields.text(setting as never, {
        codec: SETTINGS_SCHEMA.startHour.codec,
        get: () => settings.startHour,
        put: (hour) => { settings.startHour = hour; },
    });
    return { settings, saveSettings, fields, setting, input: setting.inputs[0] };
}

describe('a settings text field', () => {
    it('shows the value, and saves nothing while typing', () => {
        const f = hourField();
        expect(f.input.value).toBe('5');
        f.input.type('');
        f.input.type('4');
        expect(f.saveSettings).not.toHaveBeenCalled();
    });

    it('saves once on a blur, the text shown as read', async () => {
        const f = hourField();
        f.input.type('４');
        f.input.blur();
        expect(f.input.value).toBe('4');
        expect(f.settings.startHour).toBe(4);
        await Promise.resolve();
        f.input.blur();
        f.input.enter();
        expect(f.saveSettings).toHaveBeenCalledTimes(1);
    });

    // It used to save 0 for an emptied field.
    it('does not save an empty field, nor one out of range, and says why under the description', () => {
        const f = hourField();
        f.input.type('');
        f.input.blur();
        expect(f.settings.startHour).toBe(5);
        expect(f.input.value).toBe('');
        expect(f.setting.says()).toEqual(['error: Enter a value.']);
        expect(f.input.attrs.get('aria-invalid')).toBe('true');
        f.input.type('24');
        f.input.enter();
        expect(f.settings.startHour).toBe(5);
        expect(f.setting.says()).toEqual(['error: Enter a number from 0 to 23.']);
        expect(f.saveSettings).not.toHaveBeenCalled();
        f.input.type('6');
        expect(f.setting.says()).toEqual([]);
    });

    it('commits what is typed as the tab is hidden, and not a field drawn over', () => {
        const f = hourField();
        f.input.type('7');
        f.fields.commitAll();
        expect(f.settings.startHour).toBe(7);

        const g = hourField();
        g.input.type('8');
        g.input.isConnected = false;
        g.fields.commitAll();
        expect(g.settings.startHour).toBe(5);
    });

    it('commits an item picked from its list, and leaves an Enter to the list while it is open', () => {
        const settings = { folder: '' };
        const saveSettings = vi.fn().mockResolvedValue(undefined);
        const fields = new SettingFields({ saveSettings });
        const setting = new FakeSetting();
        let pick: (text: string) => void = () => undefined;
        const list = { listShown: false };
        fields.text(setting as never, {
            codec: SETTINGS_SCHEMA.viewTemplateFolder.codec,
            get: () => settings.folder,
            put: (folder) => { settings.folder = folder; },
            list: (_input, picked) => { pick = picked; return list; },
        });
        const input = setting.inputs[0];
        input.type('Temp');
        list.listShown = true;
        input.enter();
        expect(saveSettings).not.toHaveBeenCalled();
        pick('Templates/Views');
        expect(input.value).toBe('Templates/Views');
        expect(settings.folder).toBe('Templates/Views');
        expect(saveSettings).toHaveBeenCalledTimes(1);
    });
});

describe('the log tab\'s number fields', () => {
    function open(settings: { logRetentionDays: number; logMaxStorageMB: number }) {
        const made: FakeSetting[] = [];
        const saveSettings = vi.fn().mockResolvedValue(undefined);
        const plugin = { settings: { verboseNotice: false, ...settings }, saveSettings, getLogManager: () => null };
        const fields = new SettingFields(plugin);
        const textOf = vi.spyOn(fields, 'text').mockImplementation(function (this: SettingFields, _setting, spec) {
            const setting = new FakeSetting();
            made.push(setting);
            return SettingFields.prototype.text.call(this, setting as never, spec as never) as never;
        });
        const el = { createEl: () => ({}), createDiv: () => ({}) };
        renderLogTab(el as never, plugin as never, fields);
        textOf.mockRestore();
        const [retention, maxStorage] = made.map(s => s.inputs[0]);
        return { plugin, saveSettings, retention, maxStorage };
    }

    it.each(['3', ' 3 ', '３'])('saves %j as 3 days', (typed) => {
        const { plugin, saveSettings, retention } = open({ logRetentionDays: 7, logMaxStorageMB: 50 });
        retention.type(typed);
        retention.blur();
        expect(plugin.settings.logRetentionDays).toBe(3);
        expect(saveSettings).toHaveBeenCalledTimes(1);
    });

    it.each(['', 'abc', '0', '-1', '1.5', '3days', '0x10'])('does not save %j days', (typed) => {
        const { plugin, saveSettings, retention } = open({ logRetentionDays: 7, logMaxStorageMB: 50 });
        retention.type(typed);
        retention.blur();
        expect(plugin.settings.logRetentionDays).toBe(7);
        expect(saveSettings).not.toHaveBeenCalled();
    });

    // An emptied field used to save 0, which lifts the limit.
    it.each([['20', 20], ['0', 0]])('saves %j as %d MB (0 is no limit), and not an emptied field', (typed, mb) => {
        const { plugin, saveSettings, maxStorage } = open({ logRetentionDays: 7, logMaxStorageMB: 50 });
        maxStorage.type('');
        maxStorage.blur();
        expect(plugin.settings.logMaxStorageMB).toBe(50);
        maxStorage.type(typed);
        maxStorage.blur();
        expect(plugin.settings.logMaxStorageMB).toBe(mb);
        expect(saveSettings).toHaveBeenCalledTimes(1);
    });
});
