import { describe, it, expect } from 'vitest';
import { readSettings, SETTINGS_SCHEMA } from '../../../src/settings/SettingsSchema';
import { DEFAULT_SCOPE_KEYS, DEFAULT_SETTINGS } from '../../../src/types';

/**
 * The settings' load reads each key by the settings' table (I#11, 入力の
 * 所見4): a key missing takes its default, a key of a group too, and a
 * stored value that does not read takes its default and is told.
 */
describe('readSettings', () => {
    it('gives the defaults for nothing stored', () => {
        for (const stored of [undefined, null, 'x', {}]) {
            const { settings, fixes } = readSettings(stored);
            expect(settings).toEqual(DEFAULT_SETTINGS);
            expect(fixes).toEqual([]);
        }
    });

    it('keeps what reads, and holds every key of the settings', () => {
        const stored = { ...structuredClone(DEFAULT_SETTINGS), startHour: 4, pastDaysToShow: 1, taskHeading: 'Inbox' };
        const { settings, fixes } = readSettings(stored);
        expect(settings).toEqual(stored);
        expect(fixes).toEqual([]);
        expect(Object.keys(settings).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
    });

    // A shallow merge left `kanban` undefined for a file saved before it was a key.
    it('fills a key missing from a group with its default, keeping the group\'s others', () => {
        const positions = { ...DEFAULT_SETTINGS.defaultViewPositions, timeline: 'right' } as Record<string, unknown>;
        delete positions.kanban;
        const { settings, fixes } = readSettings({ defaultViewPositions: positions });
        expect(settings.defaultViewPositions).toEqual({ ...DEFAULT_SETTINGS.defaultViewPositions, timeline: 'right' });
        expect(fixes).toEqual([]);
    });

    it('gives the default for a value that does not read, and tells it by its path', () => {
        const { settings, fixes } = readSettings({
            startHour: 24,
            pomodoroWorkMinutes: 0,
            mobileTopOffset: '32',
            sectionSide: 'middle',
            taskHeading: '## Tasks',
            astronomy: { location: { latitude: 91, longitude: 139 } },
            logMaxStorageMB: 1.5,
        });
        expect(settings.startHour).toBe(DEFAULT_SETTINGS.startHour);
        expect(settings.pomodoroWorkMinutes).toBe(DEFAULT_SETTINGS.pomodoroWorkMinutes);
        expect(settings.mobileTopOffset).toBe(DEFAULT_SETTINGS.mobileTopOffset);
        expect(settings.sectionSide).toBe(DEFAULT_SETTINGS.sectionSide);
        expect(settings.taskHeading).toBe(DEFAULT_SETTINGS.taskHeading);
        expect(settings.astronomy.location).toEqual({ latitude: DEFAULT_SETTINGS.astronomy.location.latitude, longitude: 139 });
        expect(fixes).toEqual([
            { path: 'startHour', issue: { code: 'range', min: 0, max: 23 } },
            { path: 'taskHeading', issue: { code: 'notation', kind: 'headingMark' } },
            { path: 'sectionSide', issue: { code: 'oneOf', allowed: ['head', 'end'] } },
            { path: 'pomodoroWorkMinutes', issue: { code: 'range', min: 1 } },
            { path: 'mobileTopOffset', issue: { code: 'shape', kind: 'int' } },
            { path: 'astronomy.location.latitude', issue: { code: 'range', min: -90, max: 90 } },
            { path: 'logMaxStorageMB', issue: { code: 'shape', kind: 'int' } },
        ]);
    });

    // 論点6: no upper bound on the work and the break.
    it('takes a work and a break of any length of a minute or more', () => {
        const { settings, fixes } = readSettings({ pomodoroWorkMinutes: 200, pomodoroBreakMinutes: 90 });
        expect([settings.pomodoroWorkMinutes, settings.pomodoroBreakMinutes]).toEqual([200, 90]);
        expect(fixes).toEqual([]);
    });

    it('leaves out a key the table does not hold', () => {
        const { settings } = readSettings({ habits: [], aiIndex: true, startHour: 3 });
        expect(settings).not.toHaveProperty('habits');
        expect(settings).not.toHaveProperty('aiIndex');
        expect(settings.startHour).toBe(3);
    });

    it('reads a periodic note\'s empty format as its default format, and a path without its space', () => {
        const { settings } = readSettings({ weeklyNoteFormat: '', weeklyNoteFolder: ' Weekly ' });
        expect(settings.weeklyNoteFormat).toBe(DEFAULT_SETTINGS.weeklyNoteFormat);
        expect(settings.weeklyNoteFolder).toBe('Weekly');
    });

    it('reads the scope keys as one set: a missing key takes its default, a clash falls back whole', () => {
        expect(readSettings({ scopeKeys: { start: ' my-start ' } }).settings.scopeKeys).toEqual({ ...DEFAULT_SCOPE_KEYS, start: 'my-start' });
        const clash = readSettings({ scopeKeys: { ...DEFAULT_SCOPE_KEYS, end: 'tv-start' } });
        expect(clash.settings.scopeKeys).toEqual(DEFAULT_SCOPE_KEYS);
        expect(clash.fixes).toEqual([{ path: 'scopeKeys', issue: { code: 'duplicate' } }]);
        expect(readSettings({ scopeKeys: { ...DEFAULT_SCOPE_KEYS, color: 'tags' } }).settings.scopeKeys).toEqual(DEFAULT_SCOPE_KEYS);
    });

    it('reads the statuses as one list: a status just added (no character yet) is kept, two of one character are not', () => {
        const added = [...DEFAULT_SETTINGS.statusDefinitions, { char: '', label: '', isComplete: false }];
        expect(readSettings({ statusDefinitions: added }).settings.statusDefinitions).toEqual(added);
        const twice = [{ char: 'x', label: 'a', isComplete: true }, { char: 'x', label: 'b', isComplete: true }];
        const read = readSettings({ statusDefinitions: twice });
        expect(read.settings.statusDefinitions).toEqual(DEFAULT_SETTINGS.statusDefinitions);
        expect(read.fixes).toEqual([{ path: 'statusDefinitions', issue: { code: 'duplicate' } }]);
    });

    it('gives a default of its own: an edit of the settings does not reach DEFAULT_SETTINGS', () => {
        const { settings } = readSettings({});
        settings.statusDefinitions.push({ char: '?', label: 'q', isComplete: false });
        settings.defaultViewPositions.kanban = 'left';
        expect(DEFAULT_SETTINGS.statusDefinitions).toHaveLength(7);
        expect(DEFAULT_SETTINGS.defaultViewPositions.kanban).toBe('tab');
    });

    it('holds the defaults as values its own table reads', () => {
        expect(readSettings(structuredClone(DEFAULT_SETTINGS)).fixes).toEqual([]);
    });

    it('gives a field the range a menu reads', () => {
        expect(SETTINGS_SCHEMA.pomodoroWorkMinutes.range).toEqual({ min: 1 });
        expect(SETTINGS_SCHEMA.pomodoroWorkMinutes.codec.read('200')).toEqual({ ok: true, value: 200 });
        expect(SETTINGS_SCHEMA.startHour.codec.read('')).toEqual({ ok: false, issue: { code: 'empty' } });
    });
});
