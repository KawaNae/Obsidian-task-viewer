import { describe, it, expect, vi, beforeAll } from 'vitest';
import realMoment from 'moment';
import { TFile, TFolder } from 'obsidian';
import { dailyNotes, dateOfPath, findNote, label, linkTarget, notePath, periodicNotes, type PeriodicNote } from '../../../src/utils/PeriodicNotes';
import { registerWeekStartLocales } from '../../../src/utils/momentWeekLocale';

/**
 * The shared obsidian mock's `moment` stub ignores its format argument
 * (always returns an ISO string), which can't exercise the format strings
 * (the settings' format, strict parsing). Swap in the real `moment` package
 * for this file only — same pattern already used by momentWeekLocale.test.ts.
 */
vi.mock('obsidian', async () => {
    const actual = await vi.importActual<typeof import('../mocks/obsidian')>('../mocks/obsidian');
    return { ...actual, moment: realMoment };
});

beforeAll(() => {
    registerWeekStartLocales();
});

function makeFile(path: string): TFile {
    const f = new TFile();
    f.path = path;
    return f;
}

/** An app whose Daily notes settings are `dailyNotes` (null: the plugin off), and whose vault holds `files`. */
function makeApp(opts: { dailyNotes?: Record<string, string> | null; files?: Record<string, TFile | TFolder> } = {}) {
    const files = opts.files ?? {};
    return {
        internalPlugins: {
            getPluginById: (id: string) => {
                if (id !== 'daily-notes' || opts.dailyNotes === null) return null;
                return { instance: { options: opts.dailyNotes ?? {} } };
            },
        },
        vault: { getAbstractFileByPath: (path: string) => files[path] ?? null },
    } as any;
}

const daily = (format: string, folder = ''): PeriodicNote =>
    ({ kind: 'daily', format, folder, template: '', weekStartDay: { format: 'locale', template: 0 } });

describe('dailyNotes', () => {
    it('reads format, folder and template from the daily-notes plugin when enabled', () => {
        const app = makeApp({ dailyNotes: { format: 'YYYY/MM/DD', folder: 'Journal', template: 'Templates/Daily' } });
        expect(dailyNotes(app)).toEqual({
            kind: 'daily', format: 'YYYY/MM/DD', folder: 'Journal', template: 'Templates/Daily',
            weekStartDay: { format: 'locale', template: 0 },
        });
    });

    it('falls back to defaults for empty option values, a plugin off, and settings that throw', () => {
        const defaults = { kind: 'daily', format: 'YYYY-MM-DD', folder: '', template: '', weekStartDay: { format: 'locale', template: 0 } };
        expect(dailyNotes(makeApp({ dailyNotes: { format: '', folder: '', template: '' } }))).toEqual(defaults);
        expect(dailyNotes(makeApp({ dailyNotes: null }))).toEqual(defaults);
        expect(dailyNotes({ internalPlugins: { getPluginById: () => { throw new Error('boom'); } } } as any)).toEqual(defaults);
    });
});

describe('periodicNotes', () => {
    it('reads the kind\'s format, folder and template from the settings, in the settings\' week', () => {
        const settings = {
            weeklyNoteFormat: 'GGGG-[W]WW', weeklyNoteFolder: 'Weekly', weeklyNoteTemplate: 'T/W',
            monthlyNoteFormat: 'YYYY-MM', monthlyNoteFolder: 'Monthly', monthlyNoteTemplate: '',
            yearlyNoteFormat: 'YYYY', yearlyNoteFolder: '', yearlyNoteTemplate: '',
            weekStartDay: 1,
        } as any;
        expect(periodicNotes(settings, 'weekly')).toEqual({
            kind: 'weekly', format: 'GGGG-[W]WW', folder: 'Weekly', template: 'T/W', weekStartDay: { format: 1, template: 1 },
        });
        expect(periodicNotes(settings, 'yearly')).toMatchObject({ kind: 'yearly', format: 'YYYY', folder: '' });
    });
});

describe('notePath, linkTarget, label', () => {
    it('formats the date below the folder', () => {
        expect(notePath(daily('YYYY-MM-DD', 'DailyNotes'), '2026-08-22')).toBe('DailyNotes/2026-08-22.md');
        expect(notePath(daily('YYYY-MM-DD'), '2026-08-22')).toBe('2026-08-22.md');
        expect(notePath(daily('YYYY/MM/DD'), '2026-08-22')).toBe('2026/08/22.md');
        expect(linkTarget(daily('YYYY-MM-DD', 'DailyNotes'), '2026-08-22')).toBe('DailyNotes/2026-08-22');
        expect(label(daily('MM/DD/YYYY'), '2026-08-22')).toBe('08/22/2026');
    });

    it('counts week tokens in the week the description says', () => {
        // 2026-08-23 is a Sunday: the first day of a week starting on Sunday, the last of one starting on Monday.
        const weekly = (w: 0 | 1): PeriodicNote => ({ kind: 'weekly', format: 'gggg-[W]ww', folder: 'Weekly', template: '', weekStartDay: { format: w, template: w } });
        expect(linkTarget(weekly(1), '2026-08-23')).toBe('Weekly/2026-W34');
        expect(linkTarget(weekly(0), '2026-08-23')).toBe('Weekly/2026-W35');
    });
});

describe('dateOfPath', () => {
    it('reads a matching path back into YYYY-MM-DD', () => {
        expect(dateOfPath(daily('YYYY-MM-DD', 'DailyNotes'), 'DailyNotes/2026-08-22.md')).toBe('2026-08-22');
        expect(dateOfPath(daily('YYYY-MM-DD'), '2026-08-22.md')).toBe('2026-08-22');
    });

    it('returns null outside the folder, in a subfolder the format does not name, and for a name not strictly the format', () => {
        const desc = daily('YYYY-MM-DD', 'DailyNotes');
        expect(dateOfPath(desc, 'Other/2026-08-22.md')).toBeNull();
        expect(dateOfPath(desc, 'DailyNotes/sub/2026-08-22.md')).toBeNull();
        expect(dateOfPath(desc, 'DailyNotes/not-a-date.md')).toBeNull();
        expect(dateOfPath(desc, 'DailyNotes/2026-8-22.md')).toBeNull(); // not zero-padded
        expect(dateOfPath(desc, 'DailyNotes/2026-08-22.canvas')).toBeNull();
    });

    it('reads a format with `/` in it, below the folder, as the note it names', () => {
        const desc = daily('YYYY/MM/YYYY-MM-DD', 'Journal');
        expect(notePath(desc, '2026-10-01')).toBe('Journal/2026/10/2026-10-01.md');
        expect(dateOfPath(desc, 'Journal/2026/10/2026-10-01.md')).toBe('2026-10-01');
        // The folders disagree with the name: not the note of either day.
        expect(dateOfPath(desc, 'Journal/2026/09/2026-10-01.md')).toBeNull();
        expect(dateOfPath(desc, 'Journal/2026-10-01.md')).toBeNull();
    });
});

describe('findNote', () => {
    it('finds the note at the path, and nothing at a missing path or a folder', () => {
        const file = makeFile('DailyNotes/2026-08-22.md');
        const folder = Object.assign(new TFolder(), { path: 'DailyNotes/2026-08-23.md' });
        const app = makeApp({ files: { 'DailyNotes/2026-08-22.md': file, 'DailyNotes/2026-08-23.md': folder } });
        const desc = daily('YYYY-MM-DD', 'DailyNotes');
        expect(findNote(app, desc, '2026-08-22')).toBe(file);
        expect(findNote(app, desc, '2026-08-23')).toBeNull();
        expect(findNote(app, desc, '2026-08-24')).toBeNull();
    });
});
