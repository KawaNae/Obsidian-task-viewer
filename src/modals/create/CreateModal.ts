import { Notice, type App } from 'obsidian';
import { t } from '../../i18n';
import { refusalNotice } from '../../services/core/RefusalClause';
import type { CreatePlace, CreatePlaces } from '../../services/data/CreatePlaces';
import { createTempTask } from '../../services/data/createTempTask';
import { NO_TASK_LOOKUP } from '../../services/display/DisplayTaskConverter';
import { TaskContentInput } from '../../services/parsing/tv-inline/TaskContentInput';
import { TaskNameSuggest } from '../../suggest/TaskNameSuggest';
import { DateUtils } from '../../utils/DateUtils';
import { OverlayShell } from '../../views/sharedUI/OverlayShell';
import { attachBracketPairing } from '../form/bracketPairing';
import { DateFieldGroup, type DateKey } from '../form/DateFieldGroup';
import { FormActions } from '../form/FormActions';
import { onFormEnter } from '../form/formEnter';
import { IssueBoard, readIssue } from '../form/FormIssue';
import { CreateDialog, type CreateEntry, type CreateSurface, type CreateViewState } from './CreateDialog';

/** The dialog's fields, by the names its issues are said of. */
type CreateField = 'name' | DateKey;

/**
 * The create dialog as it looks: the name, the start, the end and the due,
 * where the line goes and why it was not written above the buttons, and
 * cancel and create (`FormActions`). Its logic, the place and the write, is
 * `CreateDialog`; this reads the fields and draws what the dialog's state
 * says.
 *
 * - The name is read as a task's name (`TaskContentInput`): a date block,
 *   a command or a trailing `^id` is said under it, and an empty name is
 *   said as one needed when a create is asked. Nothing is created then, so
 *   an Enter right after the dialog opens writes nothing.
 * - The dates are the form's date fields (`DateFieldGroup`): their
 *   placeholders show what a line in the place inherits there, and their
 *   rules read a time with no date as wanting one unless the place gives a
 *   start date (`CreateDialog.dateContext`).
 *
 * It stands on an overlay (`OverlayShell`, centered: a dialog on a desktop,
 * a sheet from below on a phone), with the focus on the name as it opens.
 */
export class CreateModal implements CreateSurface {
    private readonly overlay = new OverlayShell();
    private dialog: CreateDialog | null = null;
    private nameInput!: HTMLInputElement;
    private dateGroup!: DateFieldGroup;
    private issues!: IssueBoard<CreateField>;
    private actions!: FormActions;
    private inherits: CreateViewState['inherits'] = {};

    /**
     * @param seed what the fields open on: the day and hour of the empty
     * space the dialog was opened from.
     */
    constructor(
        private readonly app: App,
        private readonly places: CreatePlaces,
        private readonly getStartHour: () => number,
        private readonly place: CreatePlace,
        private readonly seed: Partial<CreateEntry> = {},
    ) { }

    open(): void {
        if (this.overlay.isOpen()) return;
        this.overlay.open({
            mode: 'centered',
            panelClass: 'tv-overlay__panel--dialog',
            keymap: this.app.keymap,
            initialFocus: () => this.nameInput,
            build: (bodyEl) => this.build(bodyEl),
            onClose: () => {
                this.dialog?.dispose();
                this.dialog = null;
            },
        });
    }

    private build(bodyEl: HTMLElement): void {
        bodyEl.addClass('tv-form');
        bodyEl.createEl('h2', { text: t('modal.createTask'), cls: 'tv-form__title' });

        // --- Name ---
        const nameSection = bodyEl.createDiv({ cls: 'tv-form__name-section' });
        nameSection.createEl('label', { text: t('modal.taskName') });
        this.nameInput = nameSection.createEl('input', {
            type: 'text',
            placeholder: t('modal.taskName'),
            cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow',
        });
        this.nameInput.value = this.seed.content ?? '';
        const nameSays = nameSection.createDiv({ cls: 'tv-form__says' });
        const formSays = bodyEl.createDiv({ cls: 'tv-form__says tv-form__says--form' });
        this.issues = new IssueBoard<CreateField>({
            field: (at) => (at === 'name' ? { input: this.nameInput, message: nameSays } : this.dateGroup?.slot(at) ?? null),
            form: formSays,
        });
        const nameSuggest = new TaskNameSuggest(this.app, this.nameInput);
        attachBracketPairing(this.nameInput, () => { this.readName(false); });
        // An Enter that picks from the name's list is the list's.
        onFormEnter(this.nameInput, () => this.submit(), { takesEnter: () => nameSuggest.listShown });

        // --- Start / End / Due ---
        const due = DateUtils.splitDateTime(this.seed.due ?? '');
        this.dateGroup = new DateFieldGroup(bodyEl, {
            labels: { start: t('modal.start'), end: t('modal.end'), due: t('modal.due') },
            initial: {
                startDate: this.seed.startDate ?? '',
                startTime: this.seed.startTime ?? '',
                endDate: this.seed.endDate ?? '',
                endTime: this.seed.endTime ?? '',
                dueDate: due.date ?? '',
                dueTime: due.time ?? '',
            },
            // The line as it would read in the place: its own fields, and what it inherits there.
            buildOverlayTask: (f) => ({
                ...createTempTask({
                    id: 'placeholder-temp',
                    startDate: f.startDate || undefined,
                    startTime: f.startTime || undefined,
                    endDate: f.endDate || undefined,
                    endTime: f.endTime || undefined,
                    due: DateUtils.joinDateTime(f.dueDate, f.dueTime),
                }),
                cascadeContext: this.inherits,
            }),
            getStartHour: this.getStartHour,
            taskLookup: NO_TASK_LOOKUP,
            getValidationCtx: () => this.dialog?.dateContext() ?? {},
            onEnter: () => this.submit(),
            issues: (issues) => this.issues.set('dates', issues),
        });

        // What is of the form as a whole is said above its buttons.
        bodyEl.appendChild(formSays);

        this.actions = new FormActions(bodyEl, {
            cancel: { run: () => { void this.overlay.requestClose(); } },
            actions: [{ label: t('modal.create'), busyLabel: t('modal.newTask.creating'), tone: 'cta', run: () => this.submit() }],
        });

        this.dialog = new CreateDialog(this.place, {
            facts: (place) => this.places.facts(place),
            // Said above the buttons; a notice would say it twice.
            create: (place, line) => this.places.create(place, line, { tellRefusal: false }),
            tellLate: (refused) => new Notice(refusalNotice(refused)),
            close: () => this.overlay.close(),
        }, this);
    }

    render(state: CreateViewState): void {
        this.inherits = state.inherits;
        // What the place gives changes what the fields imply and what their rules allow.
        this.dateGroup.refresh();
        this.issues.set('dialog', state.issues);
        this.actions.render({ busy: state.phase === 'creating', ctaEnabled: state.canCreate });
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

    /** Create as the fields read: the create button, or the form's Enter in a field. */
    private submit(): void {
        if (!this.dialog?.state().canCreate) return;
        const content = this.readName(true);
        const dates = this.dateGroup.read();
        if (content === null) {
            this.nameInput.focus();
            return;
        }
        if (!dates) return;
        void this.dialog.create({
            content,
            startDate: dates.startDate || undefined,
            startTime: dates.startTime || undefined,
            endDate: dates.endDate || undefined,
            endTime: dates.endTime || undefined,
            due: DateUtils.joinDateTime(dates.dueDate, dates.dueTime),
        });
    }
}
