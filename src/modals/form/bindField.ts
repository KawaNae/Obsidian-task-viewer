import type { FieldCodec, Issue, Read } from '../../utils/values/Read';
import { composingIn, onFormEnter } from './formEnter';
import { ownCommit } from '../../views/sharedUI/PressCommit';

/**
 * What the write a commit waits for came to: taken (`true`); refused with
 * the text kept as typed, as one not yet committed, where the same text
 * committed again may be taken (`false`: the note was read again since);
 * or refused for what the value holds, which the same text does not get
 * past (`'dropped'`): the field shows its value again.
 */
export type Written = boolean | 'dropped';

/** A text field bound to a value (`bindField`). */
export interface BoundField<T> {
    /**
     * What the field holds that is not its value: the reading of the text
     * typed, when it is not the value shown, or when it is the value typed
     * again over a field that makes it the row's own (`takesSame`); null
     * when the field shows its value. What a close asks of a form: saved
     * when it reads, asked about when it does not.
     */
    pending(): Read<T> | null;
    /**
     * Put a value from outside in the field (the index's echo of a write, an
     * edit made elsewhere), with no event. Text typed and not yet committed
     * is kept, and so is text committed while its write is under way; nothing
     * is put while the IME is composing: the value reaches the field once its
     * text is the value's again.
     */
    set(value: T): void;
    /**
     * Commit what the field holds now, as a blur or the form's Enter does:
     * for a value put in by a control beside the text (a picker, a clear
     * button, a list's item), and for a form that saves what is typed as it
     * closes.
     *
     * @returns false when the text stays as typed, refused at once: it does
     *   not read, or the form does not take it (`BindFieldOptions.commit`);
     *   true when it is handed on, or the field shows its value
     */
    commit(): boolean;
    /** Throw away what is typed: the field shows its value again, and says nothing. */
    discard(): void;
}

export interface BindFieldOptions<T> {
    codec: FieldCodec<T>;
    /** The value the field stands for now: what its text is compared with. */
    current(): T;
    /**
     * Called once a commit reads a value that is not the current one, with
     * that value. False when the form does not take it (a rule across its
     * fields refuses it, said by the form): the text stays as typed, as one
     * not yet committed. A promise when a write decides it ({@link Written}):
     * answered false, the text stays as typed, as one not yet committed, and
     * a value from outside does not take its place; answered `'dropped'`,
     * the field shows its value, unless something was typed or came in
     * meanwhile.
     */
    commit(value: T): boolean | void | Promise<Written>;
    /** What the field's text reads as wrong now, or null when nothing is. */
    issues(issue: Issue | null): void;
    /** Whether a list open on the field takes an Enter (`onFormEnter`). */
    takesEnter?: () => boolean;
    /**
     * Whether a commit of a text typed over the field is handed on even when
     * it reads as the current value: a field that shows a value the row
     * inherits, where typing it again makes it the row's own. A field left
     * as it was shown (focused and left, nothing typed) commits nothing.
     */
    takesSame?: () => boolean;
    /**
     * How a text is put in the field: the field's own way when it shows the
     * text elsewhere too (`PickerTextField.setText` keeps its clear button
     * and its picker in step). By default, the input's value.
     */
    put?(text: string): void;
    /**
     * Takes the field's listeners off once it aborts: a field whose row is
     * being built anew. Taking out an input that holds the focus sends it a
     * blur at once, and that blur then commits nothing. The field is let go
     * of as one that commits (`ownCommit`) then too.
     */
    signal?: AbortSignal;
}

/**
 * Bind a text field to a value of `codec`.
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
 * - The field is one that commits (`ownCommit`): a press on a button
 *   elsewhere commits it as its Enter does, before the button acts.
 */
export function bindField<T>(input: HTMLInputElement, opts: BindFieldOptions<T>): BoundField<T> {
    const { codec } = opts;
    const put = (text: string) => (opts.put ? opts.put(text) : (input.value = text));
    /** The text the field was last given (from outside, or by a commit): what it holds when nothing is typed over it. */
    let given = input.value;
    /** The write a commit is waiting for: what it decides, the field holds as typed till then. */
    let writing: Promise<Written> | null = null;
    /** Whether anything was typed since the field was last given its text (`takesSame`). */
    let typedOver = false;
    // The field's composition is followed from now on.
    composingIn(input);

    const shownValue = () => codec.show(opts.current());
    /** The value typed again over a field that makes it the row's own (`takesSame`): a commit hands it on. */
    const typedSame = () => typedOver && (opts.takesSame?.() ?? false);
    const pending = (): Read<T> | null => (input.value === shownValue() && !typedSame() ? null : codec.read(input.value));

    const check = () => {
        const read = pending();
        opts.issues(read && !read.ok ? read.issue : null);
    };

    const commit = (): boolean => {
        const same = typedSame();
        const read = pending();
        typedOver = false;
        if (read === null) {
            // The field shows its value: nothing typed over it.
            given = input.value;
            opts.issues(null);
            return true;
        }
        if (!read.ok) {
            opts.issues(read.issue);
            return false;
        }
        opts.issues(null);
        const text = codec.show(read.value);
        if (input.value !== text) put(text);
        if (text === shownValue() && !same) {
            given = text;
            return true;
        }
        const taken = opts.commit(read.value);
        if (taken === false) return false;
        const before = given;
        given = text;
        if (taken instanceof Promise) {
            writing = taken;
            void taken.then((written) => {
                if (writing !== taken) return;
                writing = null;
                if (given !== text) return;
                // Refused: the text is typed again, unless something came in meanwhile.
                if (written === false) given = before;
                // Refused for what the value holds: the field shows the value, unless typed over since.
                else if (written === 'dropped' && input.value === text) {
                    const shown = shownValue();
                    if (shown !== text) put(shown);
                    given = shown;
                }
            });
        }
        return true;
    };

    const { signal } = opts;
    input.addEventListener('input', (e) => {
        typedOver = true;
        if (!(e as InputEvent).isComposing) check();
    }, { signal });
    input.addEventListener('compositionend', check, { signal });
    input.addEventListener('blur', commit, { signal });
    onFormEnter(input, commit, { takesEnter: opts.takesEnter, signal });
    const discard = (): void => {
        writing = null;
        typedOver = false;
        const text = shownValue();
        if (input.value !== text) put(text);
        given = text;
        opts.issues(null);
    };
    ownCommit(input, {
        typed: () => pending() !== null,
        commit,
        // Typed over what it was last given: a text not handed on.
        drop: () => { if (input.value !== given) discard(); },
    }, signal);

    return {
        pending,
        set(value: T): void {
            const typed = input.value !== given;
            if (typed || writing !== null || composingIn(input)) return;
            const text = codec.show(value);
            if (input.value !== text) put(text);
            given = text;
            typedOver = false;
            opts.issues(null);
        },
        commit,
        discard,
    };
}
