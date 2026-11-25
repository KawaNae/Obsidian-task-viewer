import { setIcon } from 'obsidian';
import { t } from '../../i18n';
import { IssueBoard, type FormIssue } from '../form/FormIssue';

/** What the line above the create says, by where it comes from: where the task goes, and why a create was refused. */
export type CreateLineSource = 'place' | 'write';

/**
 * The line above the create of a hub on a task not written yet, in the
 * overlay's foot: what pressing create does, why it cannot be pressed, and
 * why a create was refused. It stands over the row of buttons, so the
 * sentence that keeps the create from being pressed is beside the create
 * however the body is scrolled.
 *
 * A button at the row's start ({@link drawToggle}) shows the line or hides
 * it, all of it, errors and warnings too: hidden, the foot is the row alone.
 * The line opens shown each time the hub opens; hiding it is not kept. While
 * it is hidden the button reads as what it would show: a chevron up, or the
 * warning mark in the tone of the worst it hides (an error's red, a
 * warning's colour). Shown, it is a chevron down, whatever the line says,
 * since the line is in sight. Once hidden, the line shows again when what it
 * says changes (its sentences, their order, or a tone): a create refused,
 * the place read again into an error. What is said again unchanged leaves
 * it hidden.
 *
 * The sentences stand in a box of their own inside the line, where the
 * board lays them out (`IssueBoard`); the line itself takes no press.
 */
export class CreateLine {
    private readonly line: HTMLElement;
    private readonly says: IssueBoard<never>;
    private toggle: HTMLButtonElement | null = null;
    private shown = true;
    /** What the line says, as last drawn: a change shows the line again. */
    private said = '';

    /** @param foot the overlay's foot: the line goes there, before the row of buttons. */
    constructor(foot: HTMLElement) {
        this.line = foot.createDiv({ cls: 'task-hub__create-line' });
        const texts = this.line.createDiv({ cls: 'tv-form__says task-hub__create-says' });
        this.says = new IssueBoard<never>({ field: () => null, form: texts });
        this.render();
    }

    /** Put the button that shows or hides the line in `row`, the row of buttons, as its first: what the row's start holds. */
    drawToggle(row: HTMLElement): HTMLElement {
        const button = row.createEl('button', { cls: 'tv-icon-btn task-hub__create-toggle', attr: { type: 'button' } });
        button.addEventListener('click', () => {
            this.shown = !this.shown;
            this.render();
        });
        this.toggle = button;
        this.render();
        return button;
    }

    /** Say `issues` as what `source` says now, in place of what it said before; a change shows the line. */
    say(source: CreateLineSource, issues: readonly FormIssue<never>[]): void {
        this.says.set(source, issues);
        const now = JSON.stringify(this.says.all().map(issue => [issue.tone, issue.text]));
        if (now !== this.said) this.shown = true;
        this.said = now;
        this.render();
    }

    private render(): void {
        // Hidden by its attribute, which the overlay's foot reads to show or not (`OverlayFrame`).
        this.line.hidden = !this.shown || this.says.all().length === 0;
        const button = this.toggle;
        if (!button) return;
        const hidden = this.shown ? null
            : this.says.has('error') ? 'error'
                : this.says.has('warning') ? 'warning'
                    : 'none';
        setIcon(button, hidden === null ? 'chevron-down' : hidden === 'none' ? 'chevron-up' : 'alert-triangle');
        button.toggleClass('is-error', hidden === 'error');
        button.toggleClass('is-warning', hidden === 'warning');
        button.setAttribute('aria-expanded', String(this.shown));
        button.setAttribute('aria-label', t(
            hidden === null ? 'modal.newTask.hideLine'
                : hidden === 'error' ? 'modal.newTask.showLineError'
                    : hidden === 'warning' ? 'modal.newTask.showLineWarning'
                        : 'modal.newTask.showLine',
        ));
    }
}
