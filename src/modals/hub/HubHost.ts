import type { Task } from '../../types';
import type { TaskLookup } from '../../services/display/DisplayTaskConverter';
import type { CloseAnswer } from '../../views/sharedUI/CloseGate';
import type { FieldFocus } from '../../utils/FieldFocus';
import type { FormIssue } from '../form/FormIssue';
import type { Written } from '../form/bindField';
import type { LineTarget } from './SourceLine';

/**
 * What the hub's form is to its host: the host tells it to take the value
 * again, to show whether its fields are shut, what of a write to say, where
 * what it holds goes, and to ask again what it holds not written yet.
 */
export interface HubForm {
    /** Take the host's value (`HubHost.task`) into every field again, and read its findings from it. */
    refresh(): void;
    /** Enable the fields or not, and say why not above the form's tabs, as `HubHost.shut` answers now. */
    showShut(): void;
    /**
     * Say why a change the fields handed on was not taken (`HubHost.put`).
     * Said while the field hands it on (a draft refuses it at once), it is
     * said under that field, beside what else was said since it was last
     * taken back. Said after (a write's answer), it is said above the form's
     * tabs, in sight from either, in place of what was said. Null takes back
     * all that was said.
     */
    sayPut(refusal: string | null): void;
    /**
     * Say why the write of what the host holds not written yet
     * (`HubDraft.write`) was refused: above the write, as what it did. Null
     * takes back what was said.
     */
    sayWrite(refusal: string | null): void;
    /** Say above the write where what is held goes, and what of that place to heed; none takes back what was said. */
    sayPlace(issues: readonly FormIssue<never>[]): void;
    /**
     * Ask `HubHost.draft` again and draw the row of buttons as it answers
     * now: with something held, cancel, its write (whether it may be asked,
     * whether one is under way, what it reads) and the line above it; with
     * nothing, none of them, taking no room. What is typed in the fields,
     * the focus, the tab chosen and a question put stay as they are.
     */
    showDraft(): void;
    /**
     * Write as the write button does: the fields seen first, what is typed
     * put in, and the host's write asked (`HubDraft.write`). The host asks
     * it again for a write that waited for its place to be read, the fields
     * opened for it, so they are seen under what the place gives now: one
     * they break takes the focus, and the host's write is not asked.
     */
    write(): void;
    /**
     * Put in what is typed in every field, as a close saves it, with no
     * question: whether all of it was. A value that cannot be saved is not,
     * nor anything else: its field takes the focus, its tab chosen first.
     */
    putTyped(): boolean;
    /**
     * Save what is typed in every field as a blur would: what reads is put
     * in, and a value that cannot be saved stays typed in its field, as a
     * blur leaves it. Nothing is asked and nothing stops: what goes on next
     * goes on.
     *
     * The form saves what is typed by this alone, at four doors that differ
     * in what a value that cannot be saved does: here it stays and nothing
     * stops; at `putTyped` and `write` it stops all, its field taking the
     * focus; at a close (`beforeClose`) and cancel it stops the step and is
     * asked about.
     */
    saveTyped(): void;
    /**
     * A write ended unwritten, the fields open again and the place read:
     * the focus goes where what keeps it from being written is, unless it is
     * in the hub already. Where a write may be asked again
     * (`HubDraft.canWrite`), nothing is to be fixed: the write. Where it may
     * not, what keeps it is the place: the place's group, where it says. Not
     * told where the form itself found a field to fix and focused it.
     */
    notWritten(): void;
    /**
     * What the host holds was edited outside the form's fields (the
     * source's text, in a move): a question put of it is withdrawn, as
     * typing in a field withdraws it.
     */
    edited(): void;
    /**
     * The host has come into a move from within the hub, all of it drawn
     * (the place's fields, the row of buttons, what is said above the
     * write): the place's first field takes the focus (`HubPlace.focus`),
     * its tab chosen first, as the hub's menu focuses a field. A hub opened
     * in a move is not told: the overlay's first focus goes there.
     */
    focusPlace(): void;
}

/**
 * How far a hub's form takes no edit, and why, as its host answers
 * (`HubHost.shut`).
 */
export interface HubShut {
    /**
     * What is shut. `'form'`: every field, the place's among them; the form
     * saves nothing and asks nothing, a close asking the host at once. While
     * the host holds what is not written yet, it is so only while its write
     * is under way (`HubDraft.writing`): cancel is a close asked then, which
     * waits for the write, closing once it is made and withdrawn once it is
     * not. `'values'`: the fields of
     * the row's values (the name, the status, the dates, the style, the
     * tags, the properties); the place's fields take edits, and cancel and
     * a close ask whether to throw away what is held (`HubDraft.changed`),
     * the fields shut saved by neither.
     */
    readonly reach: 'form' | 'values';
    /** Why, said above the form's tabs; null, nothing is said: a wait too short to be read. */
    readonly why: string | null;
}

/**
 * What a hub's host holds that is not written yet, and its write, which
 * writes all of it at once: a task to be created, as the fields hold it, or
 * a row's changes and where it goes, its move. The form shows cancel and
 * the write only while the host holds one.
 */
export interface HubDraft {
    /** What the write reads, and what it reads while it is under way. */
    readonly label: string;
    readonly busyLabel: string;
    /** The question whether to throw it away, put before a step that would lose it. */
    readonly discardAsk: string;
    /**
     * Whether the write may be asked now: where it goes has answered, what
     * is held can go there, and none is under way. While the place is being
     * read again, as the place last read says.
     */
    canWrite(): boolean;
    /** Whether the write is under way: from its press until it is written or found not to be, the fields shut. */
    writing(): boolean;
    /**
     * Write what is held as it stands now; asked once the form has put in
     * what is typed. It is under way from now, unless what is held where the
     * host edits it does not take (the source's text, in a move): nothing
     * is written then, why said there, the focus put there. Asked while the place is
     * being read, it waits, and asks the form's write again once it is read
     * where what is held can go; it ends unwritten otherwise, why said above
     * the write.
     */
    write(): void;
    /**
     * Throw away what is held, as cancel asks once the form has saved its
     * fields and the user has said to throw it away where anything would be
     * lost (`changed`); never while the write is under way. The hub stays
     * open, and the host tells the form what it holds now. Null where
     * what is held is all the hub is (a task not written yet): cancel is the
     * close the user asks for, which asks of the same loss.
     */
    readonly discard: (() => void) | null;
    /** Whether a write now would write anything other than what was held as it began: what throwing it away asks about. */
    changed(): boolean;
    /**
     * The question whether to throw it away was answered to keep it, with no
     * field the form holds left to fix: whether the host put the focus where
     * what is held is being edited. None, or false, the form's first field
     * takes it.
     */
    keep?(): boolean;
}

/**
 * The hub's form as its host sees it: the form and its fields read the value
 * and hand changes on through these, and the host decides when and where
 * anything is written. What the row's lines hold that is wrong (`hubFindings`)
 * and the fields it locks are the form's to work out from the value.
 */
export interface HubHost {
    /** The value the fields show, with what was handed on put over it. */
    task(): Task;
    /**
     * Hand a change of the fields on: whether it was taken, and, refused,
     * whether the field may keep what was typed (`Written`). A write refused
     * by the note may be taken once committed again: the field keeps it
     * (false). A draft refuses a change for what its lines hold, which the
     * same change does not get past: the field shows the value again
     * (`'dropped'`). A refusal is said by the host (`HubForm.sayPut`).
     */
    put(updates: Partial<Task> | null): Promise<Written>;
    /** How far the form takes no edit now, and why; null while it takes them all. */
    shut(): HubShut | null;
    /**
     * Open a line of the row's note in the editor and light it: the line
     * `locate` finds on a copy of the row, asked again of a newer copy when
     * the note has changed. The hub closes. Null when there is no row whose
     * lines could be opened: where a value is inherited from is said, and
     * not offered to open.
     */
    readonly openSource: ((locate: (task: Task) => LineTarget | null) => void) | null;
    /**
     * What is held not written yet, and its write, as it is now: the form
     * asks it each time it is told to draw it (`HubForm.showDraft`), and as
     * it acts on it. Null while the host writes what is handed on as it
     * comes (a row the note has, not being moved): nothing to write but
     * that, and nothing a close loses but what cannot be saved.
     */
    draft(): HubDraft | null;
    /**
     * Whether the hub may close, asked once the form has saved its fields,
     * or at once while the whole form is shut: what is under way is waited
     * for.
     */
    closing(): CloseAnswer;
    /** The form to tell, once it is built. */
    bind(form: HubForm): void;
}

/** What a hub's host asks of the panel it is in. */
export interface HubPanel {
    /** Draw the card again from the host's value. */
    redrawPreview(): void;
    /** Close the hub, asking nothing: a navigation away. */
    close(): void;
}

/**
 * What an entry builds of where a task goes, as a group of the form's basic
 * tab, after the dates: fields that say where the task goes, or a place
 * shown with no field. The form shuts it only as it shuts every field
 * (`HubShut.reach`), and focuses it (`'place'`).
 */
export interface HubPlace {
    /**
     * Where the focus goes in it, and how its text is met there: the first
     * field an error is said under, else its first field; null when it has
     * no field.
     */
    focus(): FieldFocus<HTMLElement> | null;
    /** Its fields enabled or not, as the form's are. */
    setEnabled(enabled: boolean): void;
    /** Draw again what it shows of the host's value, as the form takes the value into its fields again. */
    refresh(): void;
    /** The hub closed: it takes nothing more. */
    dispose(): void;
}

/** Builds the place's group at the end of `parent` (the form's basic tab), once, as the form is built. */
export type PlaceMaker = (parent: HTMLElement) => HubPlace;

/** A hub's host as its panel sees it: the form's host, told when the hub has opened and when it has closed. */
export interface PanelHost extends HubHost {
    /**
     * The rows the card is drawn from, the value's own and its subtree's,
     * where the index holds none of them as the value has them (a task not
     * written yet, a row's draft): the card shows the children of these and
     * takes no act, as there is no row of theirs to write to
     * (`RenderOptions.rows`). Null, the card reads the index.
     */
    cardRows(): TaskLookup | null;
    /** The hub has opened in `panel`: what the host follows from now on is drawn there. */
    attach(panel: HubPanel): void;
    /** The hub has closed: the host follows nothing more, and a refusal that comes after is told by a notice. */
    dispose(): void;
}
