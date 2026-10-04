import { DateUtils } from '../utils/DateUtils';
import { type App, Setting } from 'obsidian';
import { t } from '../i18n';
import { NO_TASK_LOOKUP } from '../services/display/DisplayTaskConverter';
import { createTempTask } from '../services/data/createTempTask';
import { TaskNameSuggest } from '../suggest/TaskNameSuggest';
import { attachBracketPairing } from './form/bracketPairing';
import { onFormEnter } from './form/formEnter';
import { DateFieldGroup, type DateKey } from './form/DateFieldGroup';
import { IssueBoard, readIssue } from './form/FormIssue';
import { TaskContentInput } from '../services/parsing/tv-inline/TaskContentInput';
import { OverlayShell } from '../views/sharedUI/OverlayShell';

/** The dialog's fields, by the names its issues are said of. */
type CreateField = 'name' | DateKey;

/**
 * What the dialog asks for: the fields of a new task line, less its status
 * and marker, which the caller supplies when it writes the line with
 * `formatTaskLine`.
 */
export interface CreateTaskResult {
    content: string;
    startDate?: string;   // YYYY-MM-DD
    startTime?: string;   // HH:mm
    endDate?: string;     // YYYY-MM-DD
    endTime?: string;     // HH:mm
    due?: string;    // YYYY-MM-DD or YYYY-MM-DDThh:mm
}

export interface CreateTaskModalOptions {
    /** Show a warning when task name and all date fields are empty (task won't appear in viewer) */
    warnOnEmptyTask?: boolean;
    /** Modal title text */
    title?: string;
    /** Submit button label */
    submitLabel?: string;
    /** Daily note date (YYYY-MM-DD). Shown as Start Date placeholder when startDate is omitted (inherited from filename). */
    dailyNoteDate?: string;
    /** Start hour for implicit value resolution via toDisplayTask(). */
    startHour?: number;
}

/**
 * 新規タスク作成フォーム。
 *
 * Obsidian Modal ではなく OverlayShell (mode: 'centered') に載せる —
 * desktop は中央ダイアログ、phone は bottom-sheet（swipe dismiss・
 * keyboard awareness・close animation 込み）。パネル寸法は共通の
 * tv-overlay__panel--dialog（_overlay.css）。
 *
 * 初めのフォーカスは名前の欄（殻の initialFocus）。名前が空のうちは作らず、
 * 欄の下に理由を出す。開いた直後の Enter で何も書かれないように。
 *
 * 名前は `TaskContentInput` で読み、日付ブロックや `==>` を含む名前は理由を
 * 出して作らない。誤りと注意は `IssueBoard` が欄の下とボタン行の上に出す。
 */
export class CreateTaskModal {
    private overlay = new OverlayShell();
    private result: CreateTaskResult;
    private onSubmit: (result: CreateTaskResult) => void;
    private options: CreateTaskModalOptions;

    private nameInput: HTMLInputElement;
    private dateGroup: DateFieldGroup;
    private issues: IssueBoard<CreateField>;

    constructor(private app: App, onSubmit: (result: CreateTaskResult) => void, initialValues: Partial<CreateTaskResult> = {}, options: CreateTaskModalOptions = {}) {
        this.onSubmit = onSubmit;
        this.result = { content: '', ...initialValues };
        this.options = options;
    }

    open(): void {
        if (this.overlay.isOpen()) return;
        this.overlay.open({
            mode: 'centered',
            panelClass: 'tv-overlay__panel--dialog',
            keymap: this.app.keymap,
            initialFocus: () => this.nameInput,
            build: (bodyEl) => this.buildContent(bodyEl),
        });
    }

    close(): void {
        this.overlay.close();
    }

    private buildContent(bodyEl: HTMLElement): void {
        // tv-ctrl は overlay root に付与済み。行文法のルートだけ足す
        bodyEl.addClass('tv-form');

        bodyEl.createEl('h2', { text: this.options.title ?? t('modal.createTask'), cls: 'tv-form__title' });

        // --- Task Name ---
        const nameSection = bodyEl.createDiv({ cls: 'tv-form__name-section' });
        nameSection.createEl('label', { text: t('modal.taskName') });
        this.nameInput = nameSection.createEl('input', {
            type: 'text',
            placeholder: t('modal.taskName'),
            cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow',
        });
        this.nameInput.value = this.result.content ?? '';
        const nameSays = nameSection.createDiv({ cls: 'tv-form__says' });
        const formSays = bodyEl.createDiv({ cls: 'tv-form__says tv-form__says--form' });
        this.issues = new IssueBoard<CreateField>({
            field: (at) => (at === 'name' ? { input: this.nameInput, message: nameSays } : this.dateGroup?.slot(at) ?? null),
            form: formSays,
        });
        const nameSuggest = new TaskNameSuggest(this.app, this.nameInput);
        attachBracketPairing(this.nameInput, () => {
            this.readName(false);
            this.checkWarning();
        });
        // An Enter that picks from the name's list is the list's.
        onFormEnter(this.nameInput, () => this.submit(), { takesEnter: () => nameSuggest.listShown });

        // --- Start / End / Due ---
        const dlParts = DateUtils.splitDateTime(this.result.due ?? '');
        this.dateGroup = new DateFieldGroup(bodyEl, {
            labels: { start: t('modal.start'), end: t('modal.end'), due: t('modal.due') },
            initial: {
                startDate: this.result.startDate || '',
                startTime: this.result.startTime || '',
                endDate: this.result.endDate || '',
                endTime: this.result.endTime || '',
                dueDate: dlParts.date || '',
                dueTime: dlParts.time || '',
            },
            buildOverlayTask: (f) => createTempTask({
                id: 'placeholder-temp',
                startDate: f.startDate || this.options.dailyNoteDate,
                startTime: f.startTime,
                endDate: f.endDate,
                endTime: f.endTime,
            }),
            getStartHour: () => this.options.startHour ?? 0,
            taskLookup: NO_TASK_LOOKUP,
            getValidationCtx: () => ({
                hasImplicitStartDate: !!this.options.dailyNoteDate,
                implicitStartDate: this.options.dailyNoteDate,
            }),
            getFallbackDatePlaceholder: () => this.options.dailyNoteDate,
            onChange: () => this.checkWarning(),
            onEnter: () => this.submit(),
            issues: (issues) => this.issues.set('dates', issues),
        });

        this.dateGroup.updatePlaceholders();

        // What is of the form as a whole is said above its buttons.
        bodyEl.appendChild(formSays);

        // --- Create button ---
        new Setting(bodyEl)
            .setClass('tv-form__actions')
            .addButton((btn) =>
                btn
                    .setButtonText(this.options.submitLabel ?? t('modal.create'))
                    .setCta()
                    .onClick(() => this.submit()));
    }

    private checkWarning(): void {
        if (!this.options.warnOnEmptyTask) return;
        const f = this.dateGroup.collect();
        const empty = !this.nameInput.value.trim()
            && !f.startDate && !f.startTime && !f.endDate && !f.endTime && !f.dueDate && !f.dueTime;
        this.issues.set('empty', empty ? [{ at: 'form', tone: 'warning', text: t('modal.emptyTaskWarning') }] : []);
    }

    /**
     * The name as read, said wrong under its field when it does not read;
     * null then. An empty name is wrong only when `required` (a submit): it
     * is not said while the name is being typed.
     */
    private readName(required: boolean): string | null {
        const text = this.nameInput.value;
        if (!text.trim()) {
            this.issues.set('name', required ? [{ at: 'name', tone: 'error', text: t('modal.nameRequired') }] : []);
            return null;
        }
        const read = TaskContentInput.read(text);
        this.issues.set('name', readIssue('name', read.ok ? null : read.issue));
        return read.ok ? read.value : null;
    }

    submit() {
        const content = this.readName(true);
        const dates = this.dateGroup.read();
        if (content === null) {
            this.nameInput.focus();
            return;
        }
        if (!dates) return;

        this.result.content = content;
        this.result.startDate = dates.startDate || undefined;
        this.result.startTime = dates.startTime || undefined;
        this.result.endDate = dates.endDate || undefined;
        this.result.endTime = dates.endTime || undefined;
        this.result.due = DateUtils.joinDateTime(dates.dueDate, dates.dueTime);
        this.close();
        this.onSubmit(this.result);
    }
}
