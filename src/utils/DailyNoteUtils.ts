import { type App, TFile, moment } from 'obsidian';
import { HeadingInserter } from './HeadingInserter';
import type { TaskViewerSettings, NoteType } from '../types';
import { processTemplate, normalizeTrailingNewline } from './NoteTemplateProcessor';
import { withWeekStartDay } from './momentWeekLocale';
import { logError, logWarn } from '../log/log';

export class DailyNoteUtils {
    static getDailyNoteSettings(app: App) {
        try {
            // @ts-ignore — app.internalPlugins is an internal Obsidian API (not in public typings)
            const dailyNotesPlugin = app.internalPlugins.getPluginById("daily-notes");
            if (dailyNotesPlugin && dailyNotesPlugin.instance) {
                return {
                    format: dailyNotesPlugin.instance.options.format || 'YYYY-MM-DD',
                    folder: dailyNotesPlugin.instance.options.folder || '',
                    template: dailyNotesPlugin.instance.options.template || ''
                };
            }
        } catch (e) {
            logError(`Failed to get Daily Notes settings: ${(e as Error)?.message ?? e}`);
        }
        return { format: 'YYYY-MM-DD', folder: '', template: '' };
    }

    /**
     * ファイルパスからデイリーノートの日付を抽出する。
     * デイリーノートでなければ null を返す。
     */
    static parseDateFromFilePath(app: App, filePath: string): string | null {
        const settings = this.getDailyNoteSettings(app);
        const folder = settings.folder ? settings.folder + '/' : '';

        // フォルダが一致するかチェック
        if (folder && !filePath.startsWith(folder)) return null;

        // ファイル名（拡張子なし）を取得
        const relativePath = folder ? filePath.slice(folder.length) : filePath;
        const fileName = relativePath.replace(/\.md$/, '');

        // サブフォルダ内のファイルは除外（デイリーノートはフォルダ直下のみ）
        if (fileName.includes('/')) return null;

        // moment で strict パース
        const m = moment(fileName, settings.format, true);
        return m.isValid() ? m.format('YYYY-MM-DD') : null;
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
        const dailySettings = this.getDailyNoteSettings(app);
        const path = this.getDailyNotePath(date, dailySettings);

        if (dailySettings.folder) {
            const folderExists = await app.vault.adapter.exists(dailySettings.folder);
            if (!folderExists) {
                await app.vault.createFolder(dailySettings.folder);
            }
        }

        const content = await this.loadAndApplyTemplate(app, dailySettings.template, {
            noteType: 'daily',
            triggerDate: date,
            filenameFormat: dailySettings.format,
            weekStartDay: 0,
        });

        return await app.vault.create(path, content);
    }

    /**
     * Read a template file (if configured) and expand placeholders. Returns '' when
     * the path is empty or the file cannot be located — silent fallback to keep
     * note creation resilient. A warn-level log is emitted for missing files so
     * misconfiguration is discoverable without nagging the user with Notices.
     */
    private static async loadAndApplyTemplate(
        app: App,
        templatePath: string,
        ctx: {
            noteType: NoteType;
            triggerDate: Date;
            filenameFormat: string;
            weekStartDay: 0 | 1;
        }
    ): Promise<string> {
        if (!templatePath) return '';

        let templateFile = app.vault.getAbstractFileByPath(templatePath);
        if (!templateFile) {
            templateFile = app.vault.getAbstractFileByPath(`${templatePath}.md`);
        }
        if (!(templateFile instanceof TFile)) {
            logWarn(`[task-viewer] Template not found for ${ctx.noteType} note: ${templatePath}`);
            return '';
        }

        const raw = await app.vault.read(templateFile);
        return normalizeTrailingNewline(processTemplate(raw, ctx));
    }

    // --- Periodic Note helpers (Weekly / Monthly / Yearly) ---

    private static getPeriodicNotePath(date: Date, format: string, folder: string, weekStartDay: 0 | 1): string {
        const dateStr = withWeekStartDay(date, weekStartDay).format(format);
        const prefix = folder ? `${folder}/` : '';
        return `${prefix}${dateStr}.md`;
    }

    private static getPeriodicNoteLinkTarget(date: Date, format: string, folder: string, weekStartDay: 0 | 1): string {
        return this.getPeriodicNotePath(date, format, folder, weekStartDay).replace(/\.md$/, '');
    }

    private static getPeriodicNote(app: App, date: Date, format: string, folder: string, weekStartDay: 0 | 1): TFile | null {
        const path = this.getPeriodicNotePath(date, format, folder, weekStartDay);
        const file = app.vault.getAbstractFileByPath(path);
        return file instanceof TFile ? file : null;
    }

    private static async createPeriodicNote(
        app: App,
        date: Date,
        format: string,
        folder: string,
        template: string,
        noteType: NoteType,
        weekStartDay: 0 | 1
    ): Promise<TFile> {
        const path = this.getPeriodicNotePath(date, format, folder, weekStartDay);
        const dir = path.substring(0, path.lastIndexOf('/'));
        if (dir) {
            const exists = await app.vault.adapter.exists(dir);
            if (!exists) {
                await app.vault.createFolder(dir);
            }
        }
        const content = await this.loadAndApplyTemplate(app, template, {
            noteType,
            triggerDate: date,
            filenameFormat: format,
            weekStartDay,
        });
        return await app.vault.create(path, content);
    }

    // Weekly
    static getWeeklyNoteLinkTarget(settings: TaskViewerSettings, date: Date): string {
        return this.getPeriodicNoteLinkTarget(date, settings.weeklyNoteFormat, settings.weeklyNoteFolder, settings.weekStartDay);
    }
    static getWeeklyNote(app: App, settings: TaskViewerSettings, date: Date): TFile | null {
        return this.getPeriodicNote(app, date, settings.weeklyNoteFormat, settings.weeklyNoteFolder, settings.weekStartDay);
    }
    static async createWeeklyNote(app: App, settings: TaskViewerSettings, date: Date): Promise<TFile> {
        return this.createPeriodicNote(
            app, date,
            settings.weeklyNoteFormat, settings.weeklyNoteFolder, settings.weeklyNoteTemplate,
            'weekly', settings.weekStartDay,
        );
    }

    // Monthly
    static getMonthlyNoteLinkTarget(settings: TaskViewerSettings, date: Date): string {
        return this.getPeriodicNoteLinkTarget(date, settings.monthlyNoteFormat, settings.monthlyNoteFolder, settings.weekStartDay);
    }
    static getMonthlyNote(app: App, settings: TaskViewerSettings, date: Date): TFile | null {
        return this.getPeriodicNote(app, date, settings.monthlyNoteFormat, settings.monthlyNoteFolder, settings.weekStartDay);
    }
    static async createMonthlyNote(app: App, settings: TaskViewerSettings, date: Date): Promise<TFile> {
        return this.createPeriodicNote(
            app, date,
            settings.monthlyNoteFormat, settings.monthlyNoteFolder, settings.monthlyNoteTemplate,
            'monthly', settings.weekStartDay,
        );
    }

    // Yearly
    static getYearlyNoteLinkTarget(settings: TaskViewerSettings, date: Date): string {
        return this.getPeriodicNoteLinkTarget(date, settings.yearlyNoteFormat, settings.yearlyNoteFolder, settings.weekStartDay);
    }
    static getYearlyNote(app: App, settings: TaskViewerSettings, date: Date): TFile | null {
        return this.getPeriodicNote(app, date, settings.yearlyNoteFormat, settings.yearlyNoteFolder, settings.weekStartDay);
    }
    static async createYearlyNote(app: App, settings: TaskViewerSettings, date: Date): Promise<TFile> {
        return this.createPeriodicNote(
            app, date,
            settings.yearlyNoteFormat, settings.yearlyNoteFolder, settings.yearlyNoteTemplate,
            'yearly', settings.weekStartDay,
        );
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
