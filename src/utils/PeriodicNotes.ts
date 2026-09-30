import { type App, TFile, moment } from 'obsidian';
import type { NoteType, TaskViewerSettings } from '../types';
import { logError } from '../log/log';
import { DateUtils } from './DateUtils';
import { parseInWeek, withWeekStartDay } from './momentWeekLocale';

/**
 * Which periodic notes there are: a daily note (Obsidian's Daily notes
 * settings), a weekly, monthly or yearly one (this plugin's settings). Every
 * question about a note of a kind — its path, the link to it, its label, the
 * day a path is the note of — is one function of this and a date, whatever
 * the kind. Making a note and putting lines in it is the write layer's
 * (`persistence/Notes`).
 */
export interface PeriodicNote {
    kind: NoteType;
    /** The moment format the note's name is, below its folder; `/` in it names folders. */
    format: string;
    /** The folder the notes are in, '' for the vault's root. */
    folder: string;
    /** The path of the template a new note is made of, '' for none. */
    template: string;
    /**
     * The week the week tokens count in: of the format (the path, the link,
     * the label; `'locale'` is moment's own, as Obsidian names a daily note),
     * and of the template as it is expanded.
     */
    weekStartDay: { format: 0 | 1 | 'locale'; template: 0 | 1 };
}

/**
 * The daily notes as Obsidian's Daily notes settings name them; its defaults
 * when the plugin is off or its settings cannot be read. A daily note is
 * named in moment's own week, as Obsidian names it, and its template
 * expanded in the week starting on Sunday.
 */
export function dailyNotes(app: App): PeriodicNote {
    let options: { format?: string; folder?: string; template?: string } = {};
    try {
        // @ts-ignore — app.internalPlugins is an internal Obsidian API (not in public typings)
        const plugin = app.internalPlugins.getPluginById('daily-notes');
        if (plugin?.instance) options = plugin.instance.options ?? {};
    } catch (e) {
        logError(`Failed to get Daily Notes settings: ${(e as Error)?.message ?? e}`);
    }
    return {
        kind: 'daily',
        format: options.format || 'YYYY-MM-DD',
        folder: options.folder || '',
        template: options.template || '',
        weekStartDay: { format: 'locale', template: 0 },
    };
}

/** The weekly, monthly or yearly notes as the settings name them, in the settings' week. */
export function periodicNotes(settings: TaskViewerSettings, kind: Exclude<NoteType, 'daily'>): PeriodicNote {
    const [format, folder, template] = {
        weekly: [settings.weeklyNoteFormat, settings.weeklyNoteFolder, settings.weeklyNoteTemplate],
        monthly: [settings.monthlyNoteFormat, settings.monthlyNoteFolder, settings.monthlyNoteTemplate],
        yearly: [settings.yearlyNoteFormat, settings.yearlyNoteFolder, settings.yearlyNoteTemplate],
    }[kind];
    return { kind, format, folder, template, weekStartDay: { format: settings.weekStartDay, template: settings.weekStartDay } };
}

/** The note's name for `date` (`YYYY-MM-DD`), below its folder: what a link to it shows. */
export function label(desc: PeriodicNote, date: string): string {
    const day = DateUtils.parseDate(date);
    const week = desc.weekStartDay.format;
    return (week === 'locale' ? moment(day) : withWeekStartDay(day, week)).format(desc.format);
}

/** What a link to the note of `date` names: its path without `.md`. */
export function linkTarget(desc: PeriodicNote, date: string): string {
    return (desc.folder ? `${desc.folder}/` : '') + label(desc, date);
}

/** The path of the note of `date`. */
export function notePath(desc: PeriodicNote, date: string): string {
    return `${linkTarget(desc, date)}.md`;
}

/**
 * The day (`YYYY-MM-DD`) `path` is the note of, or null when it is none of
 * these notes: the path below the folder, `/` and all, read strictly as the
 * format, and taken only when the day's note is that path again.
 */
export function dateOfPath(desc: PeriodicNote, path: string): string | null {
    const prefix = desc.folder ? `${desc.folder}/` : '';
    if (!path.startsWith(prefix) || !path.endsWith('.md')) return null;
    const name = path.slice(prefix.length, -'.md'.length);
    const week = desc.weekStartDay.format;
    const read = week === 'locale' ? moment(name, desc.format, true) : parseInWeek(name, desc.format, week);
    if (!read.isValid()) return null;
    const date = read.format('YYYY-MM-DD');
    return label(desc, date) === name ? date : null;
}

/** The note of `date`, or null when there is none (a folder by its path included). */
export function findNote(app: App, desc: PeriodicNote, date: string): TFile | null {
    const file = app.vault.getAbstractFileByPath(notePath(desc, date));
    return file instanceof TFile ? file : null;
}
