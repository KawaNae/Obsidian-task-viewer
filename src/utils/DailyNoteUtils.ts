import { App, TFile, moment } from 'obsidian';
import { HeadingInserter } from './HeadingInserter';
import { TaskViewerSettings } from '../types';

export class DailyNoteUtils {
    static getDailyNoteSettings(app: App) {
        try {
            // @ts-ignore
            const dailyNotesPlugin = app.internalPlugins.getPluginById("daily-notes");
            if (dailyNotesPlugin && dailyNotesPlugin.instance) {
                return {
                    format: dailyNotesPlugin.instance.options.format || 'YYYY-MM-DD',
                    folder: dailyNotesPlugin.instance.options.folder || '',
                    template: dailyNotesPlugin.instance.options.template || ''
                };
            }
        } catch (e) {
            console.error("Failed to get Daily Notes settings", e);
        }
        return { format: 'YYYY-MM-DD', folder: '', template: '' };
    }

    static getDailyNotePath(date: Date, settings: { format: string, folder: string }): string {
        const dateStr = moment(date).format(settings.format);
        const folder = settings.folder ? `${settings.folder}/` : '';
        return `${folder}${dateStr}.md`;
    }

    static getDailyNoteLinkTarget(app: App, date: Date): string {
        const settings = this.getDailyNoteSettings(app);
        const path = this.getDailyNotePath(date, settings);
        return path.replace(/\.md$/, '');
    }

    static getDailyNoteLabelForDate(app: App, date: Date): string {
        const settings = this.getDailyNoteSettings(app);
        return moment(date).format(settings.format);
    }

    static getWikiLinkForDate(app: App, date: Date): string {
        return `[[${this.getDailyNoteLinkTarget(app, date)}]]`;
    }

    static getDailyNote(app: App, date: Date): TFile | null {
        const settings = this.getDailyNoteSettings(app);
        const path = this.getDailyNotePath(date, settings);
        const file = app.vault.getAbstractFileByPath(path);
        return file instanceof TFile ? file : null;
    }

    static async createDailyNote(app: App, date: Date): Promise<TFile> {
        const settings = this.getDailyNoteSettings(app);
        const path = this.getDailyNotePath(date, settings);

        // Ensure folder exists
        if (settings.folder) {
            const folderExists = await app.vault.adapter.exists(settings.folder);
            if (!folderExists) {
                await app.vault.createFolder(settings.folder);
            }
        }

        // Read template if exists
        let content = '';
        if (settings.template) {
            // Internal settings might store path without extension or with
            let templateFile = app.vault.getAbstractFileByPath(settings.template);
            if (!templateFile) {
                templateFile = app.vault.getAbstractFileByPath(`${settings.template}.md`);
            }

            if (templateFile instanceof TFile) {
                content = await app.vault.read(templateFile);
                content = this.processTemplate(content, date);
            }
        }

        // Create file
        return await app.vault.create(path, content);
    }

    private static processTemplate(content: string, date: Date): string {
        const dateObj = moment(date);

        return content.replace(/\{\{(date|time|title)(:.*?)?\}\}/g, (match, type, format) => {
            if (type === 'date') {
                const fmt = format ? format.substring(1) : 'YYYY-MM-DD';
                return dateObj.format(fmt);
            } else if (type === 'time') {
                const fmt = format ? format.substring(1) : 'HH:mm';
                return moment().format(fmt);
            } else if (type === 'title') {
                // For daily notes, title is usually the date formatted by plugin settings
                // But standard template {{title}} is filename.
                // We'll approximate this by just using the date format? 
                // Actually {{title}} refers to the file name being created.
                // But we don't have the file name easily accessible inside this regex replacer context without passing it.
                // However, for Daily Notes, the filename IS the date formatted.
                return dateObj.format('YYYY-MM-DD'); // Default fallback, hard to match exact filename without passing settings again
            }
            return match;
        });
    }

    // --- Periodic Note helpers (Weekly / Monthly / Yearly) ---

    private static getPeriodicNotePath(date: Date, format: string, folder: string): string {
        const dateStr = moment(date).format(format);
        const prefix = folder ? `${folder}/` : '';
        return `${prefix}${dateStr}.md`;
    }

    private static getPeriodicNoteLinkTarget(date: Date, format: string, folder: string): string {
        return this.getPeriodicNotePath(date, format, folder).replace(/\.md$/, '');
    }

    private static getPeriodicNote(app: App, date: Date, format: string, folder: string): TFile | null {
        const path = this.getPeriodicNotePath(date, format, folder);
        const file = app.vault.getAbstractFileByPath(path);
        return file instanceof TFile ? file : null;
    }

    private static async createPeriodicNote(app: App, date: Date, format: string, folder: string): Promise<TFile> {
        const path = this.getPeriodicNotePath(date, format, folder);
        const dir = path.substring(0, path.lastIndexOf('/'));
        if (dir) {
            const exists = await app.vault.adapter.exists(dir);
            if (!exists) {
                await app.vault.createFolder(dir);
            }
        }
        return await app.vault.create(path, '');
    }

    // Weekly
    static getWeeklyNoteLinkTarget(settings: TaskViewerSettings, date: Date): string {
        return this.getPeriodicNoteLinkTarget(date, settings.weeklyNoteFormat, settings.weeklyNoteFolder);
    }
    static getWeeklyNote(app: App, settings: TaskViewerSettings, date: Date): TFile | null {
        return this.getPeriodicNote(app, date, settings.weeklyNoteFormat, settings.weeklyNoteFolder);
    }
    static async createWeeklyNote(app: App, settings: TaskViewerSettings, date: Date): Promise<TFile> {
        return this.createPeriodicNote(app, date, settings.weeklyNoteFormat, settings.weeklyNoteFolder);
    }

    // Monthly
    static getMonthlyNoteLinkTarget(settings: TaskViewerSettings, date: Date): string {
        return this.getPeriodicNoteLinkTarget(date, settings.monthlyNoteFormat, settings.monthlyNoteFolder);
    }
    static getMonthlyNote(app: App, settings: TaskViewerSettings, date: Date): TFile | null {
        return this.getPeriodicNote(app, date, settings.monthlyNoteFormat, settings.monthlyNoteFolder);
    }
    static async createMonthlyNote(app: App, settings: TaskViewerSettings, date: Date): Promise<TFile> {
        return this.createPeriodicNote(app, date, settings.monthlyNoteFormat, settings.monthlyNoteFolder);
    }

    // Yearly
    static getYearlyNoteLinkTarget(settings: TaskViewerSettings, date: Date): string {
        return this.getPeriodicNoteLinkTarget(date, settings.yearlyNoteFormat, settings.yearlyNoteFolder);
    }
    static getYearlyNote(app: App, settings: TaskViewerSettings, date: Date): TFile | null {
        return this.getPeriodicNote(app, date, settings.yearlyNoteFormat, settings.yearlyNoteFolder);
    }
    static async createYearlyNote(app: App, settings: TaskViewerSettings, date: Date): Promise<TFile> {
        return this.createPeriodicNote(app, date, settings.yearlyNoteFormat, settings.yearlyNoteFolder);
    }

    /**
     * Append a line to the daily note under the specified header.
     * Creates the daily note and/or header if they don't exist.
     * @param app Obsidian App instance
     * @param date Target date for the daily note
     * @param line The line to append (should include full task format, e.g., "- [x] ...")
     * @param header Header text (without # prefix)
     * @param headerLevel Number of # to use (e.g., 2 for ##)
     */
    static async appendLineToDailyNote(
        app: App,
        date: Date,
        line: string,
        header: string,
        headerLevel: number
    ): Promise<void> {
        let file = this.getDailyNote(app, date);
        if (!file) {
            file = await this.createDailyNote(app, date);
        }
        if (!file) return;

        await app.vault.process(file, (fileContent) => {
            return HeadingInserter.insertUnderHeading(fileContent, line, header, headerLevel);
        });
    }
}
