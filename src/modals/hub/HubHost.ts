import type { Task } from '../../types';
import type { CloseAnswer } from '../../views/sharedUI/CloseGate';
import type { FieldFocus } from '../../utils/FieldFocus';
import type { FormIssue } from '../form/FormIssue';
import type { LineTarget } from './SourceLine';

/**
 * What the hub's form is to its host: the host tells it to take the value
 * again, to show whether its fields are shut, what of a write to say, where
 * what it holds goes, and to ask again what it holds not written yet.
 */
export interface HubForm {
    /** Take the host's value (`HubHost.task`) into every field again, and read its findings from it. */
    refresh(): void;
    /** Enable the fields or not, and say why not above the form's tabs, as `HubHost.shut` says now. */
    showShut(): void;
    /**
     * Say why a write was refused: while the host holds something not
     * written yet (`HubHost.draft`), above its write, as what the write did;
     * otherwise above the form's tabs. Null takes back what was said.
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
     * A write ended unwritten, the fields open again and the place read:
     * the focus goes where what keeps it from being written is, unless it is
     * in the hub already. Where a write may be asked again
     * (`HubDraft.canWrite`), nothing is to be fixed: the write. Where it may
     * not, what keeps it is the place: the place's group, where it says. Not
     * told where the form itself found a field to fix and focused it.
     */
    notWritten(): void;
}

/**
 * What a hub's host holds that is not written yet, and its write, which
 * writes all of it at once: a task to be created, as the fields hold it.
 * The form shows cancel and the write only while the host holds one.
 */
export interface HubDraft {
    /** What the write reads, and what it reads while it is under way. */
    readonly label: string;
    readonly busyLabel: string;
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
     * what is typed. It is under way from now. Asked while the place is
     * being read, it waits, and asks the form's write again once it is read
     * where what is held can go; it ends unwritten otherwise, why said above
     * the write.
     */
    write(): void;
    /**
     * Throw away what is held, as cancel asks once the form has saved its
     * fields and the user has said to throw it away where anything would be
     * lost (`changed`); asked at once while the fields are shut. The hub
     * stays open, and the host tells the form what it holds now. Null where
     * what is held is all the hub is (a task not written yet): cancel is the
     * close the user asks for, which asks of the same loss.
     */
    readonly discard: (() => void) | null;
    /** Whether a write now would write anything other than what was held as it began: what throwing it away asks about. */
    changed(): boolean;
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
     * Hand a change of the fields on: whether it was taken. A refusal is said
     * by the host (`HubForm.sayWrite`); a field refused keeps what was typed.
     */
    put(updates: Partial<Task> | null): Promise<boolean>;
    /** Why the fields take no edit now, in the words the form says it in; null while they take them. */
    shut(): string | null;
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
     * comes (a row the note has): nothing to write but that, and nothing a
     * close loses but what cannot be saved.
     */
    draft(): HubDraft | null;
    /**
     * Whether the hub may close, asked once the form has saved its fields,
     * or at once while they are shut: what is under way is waited for.
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
 * shown with no field. The form shuts it with its own fields and focuses it
 * (`'place'`).
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
    /** The hub has opened in `panel`: what the host follows from now on is drawn there. */
    attach(panel: HubPanel): void;
    /** The hub has closed: the host follows nothing more, and a refusal that comes after is told by a notice. */
    dispose(): void;
}
