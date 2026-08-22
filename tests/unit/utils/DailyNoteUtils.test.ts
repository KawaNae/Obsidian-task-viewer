import { describe, it, expect, vi, beforeAll } from 'vitest';
import realMoment from 'moment';
import { TFile, TFolder } from 'obsidian';
import { DailyNoteUtils } from '../../../src/utils/DailyNoteUtils';
import { registerWeekStartLocales } from '../../../src/utils/momentWeekLocale';

/**
 * The shared obsidian mock's `moment` stub ignores its format argument
 * (always returns an ISO string), which can't exercise DailyNoteUtils'
 * format-string handling (settings.format, strict parsing). Swap in the
 * real `moment` package for this file only — same pattern already used by
 * momentWeekLocale.test.ts.
 */
vi.mock('obsidian', async () => {
    const actual = await vi.importActual<typeof import('../mocks/obsidian')>('../mocks/obsidian');
    return { ...actual, moment: realMoment };
});

beforeAll(() => {
    registerWeekStartLocales(); // needed for createDailyNote's {{date}}/{{title}} template expansion path
});

function makeFile(path: string): TFile {
    const f = new TFile();
    f.path = path;
    f.basename = path.replace(/\.md$/, '').split('/').pop() ?? '';
    return f;
}

function makeApp(opts: {
    dailyNotes?: { format?: string; folder?: string; template?: string } | null;
    files?: Record<string, TFile | TFolder>;
    folderExists?: boolean;
    templateContent?: string;
} = {}) {
    const files = opts.files ?? {};
    const createFolder = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockImplementation(async (path: string, content: string) => {
        const f = makeFile(path);
        (f as any).__content = content;
        return f;
    });
    const read = vi.fn().mockResolvedValue(opts.templateContent ?? '');
    const existsFn = vi.fn().mockResolvedValue(opts.folderExists ?? true);

    return {
        internalPlugins: {
            getPluginById: (id: string) => {
                if (id !== 'daily-notes') return null;
                if (opts.dailyNotes === null) return null;
                return { instance: { options: opts.dailyNotes ?? {} } };
            },
        },
        vault: {
            getAbstractFileByPath: (path: string) => files[path] ?? null,
            adapter: { exists: existsFn },
            createFolder,
            create,
            read,
        },
    } as any;
}

describe('DailyNoteUtils.getDailyNoteSettings', () => {
    it('reads format/folder/template from the daily-notes plugin when enabled', () => {
        const app = makeApp({ dailyNotes: { format: 'YYYY/MM/DD', folder: 'Journal', template: 'Templates/Daily' } });
        expect(DailyNoteUtils.getDailyNoteSettings(app)).toEqual({
            format: 'YYYY/MM/DD', folder: 'Journal', template: 'Templates/Daily',
        });
    });

    it('falls back to defaults for empty-string option values', () => {
        const app = makeApp({ dailyNotes: { format: '', folder: '', template: '' } });
        expect(DailyNoteUtils.getDailyNoteSettings(app)).toEqual({
            format: 'YYYY-MM-DD', folder: '', template: '',
        });
    });

    it('falls back to defaults when the daily-notes plugin is disabled', () => {
        const app = makeApp({ dailyNotes: null });
        expect(DailyNoteUtils.getDailyNoteSettings(app)).toEqual({
            format: 'YYYY-MM-DD', folder: '', template: '',
        });
    });

    it('falls back to defaults when reading internalPlugins throws', () => {
        const app = { internalPlugins: { getPluginById: () => { throw new Error('boom'); } } } as any;
        expect(DailyNoteUtils.getDailyNoteSettings(app)).toEqual({
            format: 'YYYY-MM-DD', folder: '', template: '',
        });
    });
});

describe('DailyNoteUtils.getDailyNotePath', () => {
    it('formats the date and prefixes the folder when one is configured', () => {
        const date = new Date(Date.UTC(2026, 7, 22));
        const path = DailyNoteUtils.getDailyNotePath(date, { format: 'YYYY-MM-DD', folder: 'DailyNotes' });
        expect(path).toBe('DailyNotes/2026-08-22.md');
    });

    it('omits the folder prefix when none is configured', () => {
        const date = new Date(Date.UTC(2026, 7, 22));
        const path = DailyNoteUtils.getDailyNotePath(date, { format: 'YYYY-MM-DD', folder: '' });
        expect(path).toBe('2026-08-22.md');
    });

    it('honors a custom format string', () => {
        const date = new Date(Date.UTC(2026, 7, 22));
        const path = DailyNoteUtils.getDailyNotePath(date, { format: 'YYYY/MM/DD', folder: '' });
        expect(path).toBe('2026/08/22.md');
    });
});

describe('DailyNoteUtils.parseDateFromFilePath', () => {
    it('parses a matching file name back into YYYY-MM-DD', () => {
        const app = makeApp({ dailyNotes: { format: 'YYYY-MM-DD', folder: 'DailyNotes' } });
        expect(DailyNoteUtils.parseDateFromFilePath(app, 'DailyNotes/2026-08-22.md')).toBe('2026-08-22');
    });

    it('returns null when the folder does not match', () => {
        const app = makeApp({ dailyNotes: { format: 'YYYY-MM-DD', folder: 'DailyNotes' } });
        expect(DailyNoteUtils.parseDateFromFilePath(app, 'Other/2026-08-22.md')).toBeNull();
    });

    it('returns null for a file nested in a subfolder under the daily notes folder', () => {
        const app = makeApp({ dailyNotes: { format: 'YYYY-MM-DD', folder: 'DailyNotes' } });
        expect(DailyNoteUtils.parseDateFromFilePath(app, 'DailyNotes/sub/2026-08-22.md')).toBeNull();
    });

    it('returns null when the file name does not strictly match the configured format', () => {
        const app = makeApp({ dailyNotes: { format: 'YYYY-MM-DD', folder: 'DailyNotes' } });
        expect(DailyNoteUtils.parseDateFromFilePath(app, 'DailyNotes/not-a-date.md')).toBeNull();
        expect(DailyNoteUtils.parseDateFromFilePath(app, 'DailyNotes/2026-8-22.md')).toBeNull(); // not zero-padded
    });

    it('works with no folder configured', () => {
        const app = makeApp({ dailyNotes: { format: 'YYYY-MM-DD', folder: '' } });
        expect(DailyNoteUtils.parseDateFromFilePath(app, '2026-08-22.md')).toBe('2026-08-22');
    });
});

describe('DailyNoteUtils.getDailyNoteLinkTarget / getDailyNoteLabelForDate / getWikiLinkForDate', () => {
    it('derives the link target by stripping .md from the daily note path', () => {
        const app = makeApp({ dailyNotes: { format: 'YYYY-MM-DD', folder: 'DailyNotes' } });
        const date = new Date(Date.UTC(2026, 7, 22));
        expect(DailyNoteUtils.getDailyNoteLinkTarget(app, date)).toBe('DailyNotes/2026-08-22');
    });

    it('formats the label using the configured format', () => {
        const app = makeApp({ dailyNotes: { format: 'MM/DD/YYYY', folder: '' } });
        const date = new Date(Date.UTC(2026, 7, 22));
        expect(DailyNoteUtils.getDailyNoteLabelForDate(app, date)).toBe('08/22/2026');
    });

    it('wraps the link target in wikilink brackets', () => {
        const app = makeApp({ dailyNotes: { format: 'YYYY-MM-DD', folder: 'DailyNotes' } });
        const date = new Date(Date.UTC(2026, 7, 22));
        expect(DailyNoteUtils.getWikiLinkForDate(app, date)).toBe('[[DailyNotes/2026-08-22]]');
    });
});

describe('DailyNoteUtils.getDailyNote', () => {
    it('returns the TFile when a daily note exists at the resolved path', () => {
        const file = makeFile('DailyNotes/2026-08-22.md');
        const app = makeApp({
            dailyNotes: { format: 'YYYY-MM-DD', folder: 'DailyNotes' },
            files: { 'DailyNotes/2026-08-22.md': file },
        });
        expect(DailyNoteUtils.getDailyNote(app, new Date(Date.UTC(2026, 7, 22)))).toBe(file);
    });

    it('returns null when nothing exists at the resolved path', () => {
        const app = makeApp({ dailyNotes: { format: 'YYYY-MM-DD', folder: 'DailyNotes' } });
        expect(DailyNoteUtils.getDailyNote(app, new Date(Date.UTC(2026, 7, 22)))).toBeNull();
    });

    it('returns null when the path resolves to a folder, not a file', () => {
        const folder = new TFolder();
        folder.path = 'DailyNotes/2026-08-22.md';
        const app = makeApp({
            dailyNotes: { format: 'YYYY-MM-DD', folder: 'DailyNotes' },
            files: { 'DailyNotes/2026-08-22.md': folder as any },
        });
        expect(DailyNoteUtils.getDailyNote(app, new Date(Date.UTC(2026, 7, 22)))).toBeNull();
    });
});

describe('DailyNoteUtils.createDailyNote', () => {
    it('creates the configured folder when it does not exist yet', async () => {
        const app = makeApp({ dailyNotes: { format: 'YYYY-MM-DD', folder: 'DailyNotes' }, folderExists: false });
        await DailyNoteUtils.createDailyNote(app, new Date(Date.UTC(2026, 7, 22)));
        expect(app.vault.createFolder).toHaveBeenCalledWith('DailyNotes');
    });

    it('does not create the folder when it already exists', async () => {
        const app = makeApp({ dailyNotes: { format: 'YYYY-MM-DD', folder: 'DailyNotes' }, folderExists: true });
        await DailyNoteUtils.createDailyNote(app, new Date(Date.UTC(2026, 7, 22)));
        expect(app.vault.createFolder).not.toHaveBeenCalled();
    });

    it('checks/creates no folder at all when no daily-notes folder is configured', async () => {
        const app = makeApp({ dailyNotes: { format: 'YYYY-MM-DD', folder: '' } });
        await DailyNoteUtils.createDailyNote(app, new Date(Date.UTC(2026, 7, 22)));
        expect(app.vault.adapter.exists).not.toHaveBeenCalled();
        expect(app.vault.createFolder).not.toHaveBeenCalled();
    });

    it('creates the note at the resolved path with empty content when no template is configured', async () => {
        const app = makeApp({ dailyNotes: { format: 'YYYY-MM-DD', folder: 'DailyNotes', template: '' } });
        const file = await DailyNoteUtils.createDailyNote(app, new Date(Date.UTC(2026, 7, 22)));
        expect(app.vault.create).toHaveBeenCalledWith('DailyNotes/2026-08-22.md', '');
        expect(file.path).toBe('DailyNotes/2026-08-22.md');
    });

    it('expands the template file content ({{date}}/{{title}}) when the template exists', async () => {
        const templateFile = makeFile('Templates/Daily.md');
        const app = makeApp({
            dailyNotes: { format: 'YYYY-MM-DD', folder: 'DailyNotes', template: 'Templates/Daily' },
            files: { 'Templates/Daily.md': templateFile },
            templateContent: '# {{title}}\n\nDate: {{date}}',
        });
        await DailyNoteUtils.createDailyNote(app, new Date(Date.UTC(2026, 7, 22)));
        const [, content] = (app.vault.create as any).mock.calls[0];
        expect(content).toBe('# 2026-08-22\n\nDate: 2026-08-22\n'); // normalizeTrailingNewline adds the trailing \n
    });

    it('resolves the template path without .md before trying the .md-suffixed variant', async () => {
        const templateFile = makeFile('Templates/Daily.md');
        const app = makeApp({
            dailyNotes: { format: 'YYYY-MM-DD', folder: 'DailyNotes', template: 'Templates/Daily' },
            files: { 'Templates/Daily.md': templateFile },
            templateContent: 'body',
        });
        await DailyNoteUtils.createDailyNote(app, new Date(Date.UTC(2026, 7, 22)));
        expect(app.vault.read).toHaveBeenCalledWith(templateFile);
    });

    it('falls back to empty content and logs a warning when the configured template cannot be found', async () => {
        const app = makeApp({ dailyNotes: { format: 'YYYY-MM-DD', folder: 'DailyNotes', template: 'Missing/Template' } });
        await DailyNoteUtils.createDailyNote(app, new Date(Date.UTC(2026, 7, 22)));
        expect(app.vault.create).toHaveBeenCalledWith('DailyNotes/2026-08-22.md', '');
    });
});

describe('DailyNoteUtils weekly note helpers (representative of the periodic-note family)', () => {
    const settings = {
        weeklyNoteFormat: 'GGGG-[W]WW', weeklyNoteFolder: 'Weekly', weeklyNoteTemplate: '',
        weekStartDay: 1 as const,
    } as any;

    it('getWeeklyNoteLinkTarget resolves the ISO week for the configured weekStartDay', () => {
        // 2026-08-22 is a Saturday; with weekStartDay=1 (Monday) it's still in ISO week 34.
        const date = new Date(Date.UTC(2026, 7, 22));
        expect(DailyNoteUtils.getWeeklyNoteLinkTarget(settings, date)).toBe('Weekly/2026-W34');
    });

    it('getWeeklyNote resolves the TFile at the weekly path', () => {
        const file = makeFile('Weekly/2026-W34.md');
        const app = makeApp({ files: { 'Weekly/2026-W34.md': file } });
        const date = new Date(Date.UTC(2026, 7, 22));
        expect(DailyNoteUtils.getWeeklyNote(app, settings, date)).toBe(file);
    });
});
