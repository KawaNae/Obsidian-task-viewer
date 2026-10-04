import type { Issue } from '../../utils/values/Read';
import { issueWords } from './issueWords';

/**
 * What a form says of what it holds, and where (I#2): an error keeps the
 * form from doing what it is for, a warning is what it can be done in spite
 * of, and an info is what it will do.
 */
export type Tone = 'error' | 'warning' | 'info';

/**
 * One thing a form says: of a field (`F`, the form's names for its fields,
 * such as the hub's `'startDate'`), or of the form as a whole (`'form'`).
 */
export interface FormIssue<F extends string> {
    readonly at: F | 'form';
    readonly tone: Tone;
    readonly text: string;
}

/** Where a field's issues go: its control, marked when one is an error, and the line under its row. */
export interface IssueSlot {
    /** The control an error marks (`aria-invalid`, the red border); null when there is none to mark. */
    readonly input: HTMLElement | null;
    readonly message: HTMLElement;
}

/** An issue of a reading (`utils/values`), as the error a form says of the field it was read from. */
export function readIssue<F extends string>(at: F, issue: Issue | null): FormIssue<F>[] {
    return issue ? [{ at, tone: 'error', text: issueWords(issue) }] : [];
}

/**
 * The issues a form holds and where they are shown: the one place a form's
 * errors, warnings and infos are put, each next to what it is of.
 *
 * Issues come from sources (the dates' rules, a field's reading, a write's
 * answer), and each source replaces only its own ({@link set}): a source
 * does not take back what another said, so the hub's date rules no longer
 * clear a reserved key's error, and the other way round.
 *
 * An issue of a field is said under the field's row and, an error, marks
 * its control; one of the form is said where the form puts it (above its
 * buttons, or at its end). A field that has no slot now (a row that is
 * gone) has its issues said with the form's, so none is lost. Whether a
 * field is wrong is read from the errors held ({@link has}), not kept apart.
 */
export class IssueBoard<F extends string> {
    private readonly bySource = new Map<string, readonly FormIssue<F>[]>();
    /** What the last drawing touched, to undo before the next. */
    private drawnMessages = new Set<HTMLElement>();
    private drawnInputs = new Set<HTMLElement>();

    constructor(private readonly slots: {
        /** Where the field `at` says its issues now; null when it has no place. */
        field(at: F): IssueSlot | null;
        form: HTMLElement;
    }) { }

    /** Put `issues` as what `source` says now, in place of what it said before. */
    set(source: string, issues: readonly FormIssue<F>[]): void {
        const before = this.bySource.get(source) ?? [];
        if (issues.length === 0 && before.length === 0) return;
        if (issues.length === 0) this.bySource.delete(source);
        else this.bySource.set(source, [...issues]);
        this.redraw();
    }

    /** Whether an issue of `tone` is held, of the field `at` or of any. */
    has(tone: Tone, at?: F | 'form'): boolean {
        return this.all().some(issue => issue.tone === tone && (at === undefined || issue.at === at));
    }

    /** Every issue held, in the order their sources first spoke. */
    all(): FormIssue<F>[] {
        return [...this.bySource.values()].flat();
    }

    /**
     * Draw the issues again where their slots are now: after a part of the
     * form was built anew (the hub's properties after a write), so that its
     * new elements show what is still held.
     */
    redraw(): void {
        for (const el of this.drawnMessages) el.empty();
        for (const el of this.drawnInputs) mark(el, false);
        const messages = new Map<HTMLElement, FormIssue<F>[]>();
        const inputs = new Set<HTMLElement>();

        for (const issue of this.all()) {
            const slot = issue.at === 'form' ? null : this.slots.field(issue.at);
            const message = slot?.message ?? this.slots.form;
            const said = messages.get(message) ?? [];
            // The same sentence once in one place (two fields of one row may say it).
            if (!said.some(one => one.tone === issue.tone && one.text === issue.text)) said.push(issue);
            messages.set(message, said);
            if (issue.tone === 'error' && slot?.input) inputs.add(slot.input);
        }

        for (const [el, issues] of messages) {
            for (const issue of issues) el.createDiv({ cls: `tv-form__${issue.tone}`, text: issue.text });
        }
        for (const el of inputs) mark(el, true);
        this.drawnMessages = new Set(messages.keys());
        this.drawnInputs = inputs;
    }
}

/** An error's mark on a control: the red border of a text input, or of a box that holds one. */
function mark(el: HTMLElement, wrong: boolean): void {
    const cls = el.classList.contains('tv-ctrl__input-wrap') ? 'tv-ctrl__input-wrap--invalid' : 'tv-ctrl__text-input--invalid';
    el.classList.toggle(cls, wrong);
    if (wrong) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');
}
