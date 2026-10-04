import type { FieldCodec, Issue, Read } from '../../utils/values/Read';
import { composingIn, onFormEnter } from './formEnter';

/** A text field bound to a value (`bindField`). */
export interface BoundField<T> {
    /**
     * What the field holds that is not its value: the reading of the text
     * typed, when it is not the value shown; null when the field shows its
     * value. What a close asks of a form (10d).
     */
    pending(): Read<T> | null;
    /**
     * Put a value from outside in the field (the index's echo of a write, an
     * edit made elsewhere), with no event. Text typed and not yet committed
     * is kept, and nothing is put while the IME is composing: the value
     * reaches the field once its text is the value's again.
     */
    set(value: T): void;
    /**
     * Commit what the field holds now, as a blur or the form's Enter does:
     * for a value put in by a control beside the text (a picker, a clear
     * button, a list's item).
     */
    commit(): void;
}

export interface BindFieldOptions<T> {
    codec: FieldCodec<T>;
    /** The value the field stands for now: what its text is compared with. */
    current(): T;
    /**
     * Called once a commit reads a value that is not the current one, with
     * that value. False when the form does not take it (a rule across its
     * fields refuses it, said by the form): the text stays as typed, as one
     * not yet committed.
     */
    commit(value: T): boolean | void;
    /** What the field's text reads as wrong now, or null when nothing is. */
    issues(issue: Issue | null): void;
    /** Whether a list open on the field takes an Enter (`onFormEnter`). */
    takesEnter?: () => boolean;
    /**
     * How a text is put in the field: the field's own way when it shows the
     * text elsewhere too (`PickerTextField.setText` keeps its clear button
     * and its picker in step). By default, the input's value.
     */
    put?(text: string): void;
}

/**
 * Bind a text field to a value of `codec` (I#7, I#11, 入力の論点 C, E).
 *
 * - While typing, the text is read and what it reads as wrong is said
 *   (`issues`), but nothing is written and the text is left as typed. A
 *   text that is the current value's says nothing.
 * - A blur or the form's Enter (`onFormEnter`, so not an IME's Enter, nor
 *   one a list takes) commits: a text that reads is shown as the codec
 *   shows it (`２０２６ー１０ー０５` becomes `2026-10-05`) and handed to
 *   `commit` once, unless it is the current value; a text that does not
 *   read stays as typed, said wrong, and is not committed.
 * - A value from outside comes in by {@link BoundField.set}, which fires no
 *   event: what the field holds is told apart by its text, not by where an
 *   event came from.
 */
export function bindField<T>(input: HTMLInputElement, opts: BindFieldOptions<T>): BoundField<T> {
    const { codec } = opts;
    const put = (text: string) => (opts.put ? opts.put(text) : (input.value = text));
    /** The text the field was last given (from outside, or by a commit): what it holds when nothing is typed over it. */
    let given = input.value;
    // The field's composition is followed from now on.
    composingIn(input);

    const shownValue = () => codec.show(opts.current());
    const pending = (): Read<T> | null => (input.value === shownValue() ? null : codec.read(input.value));

    const check = () => {
        const read = pending();
        opts.issues(read && !read.ok ? read.issue : null);
    };

    const commit = () => {
        const read = pending();
        if (read === null) return opts.issues(null);
        if (!read.ok) return opts.issues(read.issue);
        opts.issues(null);
        const text = codec.show(read.value);
        if (input.value !== text) put(text);
        if (text !== shownValue() && opts.commit(read.value) === false) return;
        given = text;
    };

    input.addEventListener('input', (e) => {
        if (!(e as InputEvent).isComposing) check();
    });
    input.addEventListener('compositionend', check);
    input.addEventListener('blur', commit);
    onFormEnter(input, commit, { takesEnter: opts.takesEnter });

    return {
        pending,
        set(value: T): void {
            const typed = input.value !== given;
            if (typed || composingIn(input)) return;
            const text = codec.show(value);
            if (input.value !== text) put(text);
            given = text;
            opts.issues(null);
        },
        commit,
    };
}
