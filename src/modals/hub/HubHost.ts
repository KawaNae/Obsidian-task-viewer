import type { Task } from '../../types';
import type { CloseAnswer } from '../../views/sharedUI/CloseGate';
import type { FormIssue } from '../form/FormIssue';
import type { LineTarget } from './SourceLine';

/**
 * What the hub's form is to its host: the host tells it to take the value
 * again, to show whether its fields are shut, what of a write to say, and,
 * for a task not written yet, where it goes and whether it can be created.
 */
export interface HubForm {
    /** Take the host's value (`HubHost.task`) into every field again, and read its findings from it. */
    refresh(): void;
    /** Enable the fields or not, and say why not at the form's end, as `HubHost.shut` says now. */
    showShut(): void;
    /** Say at the form's end why a write was refused; null takes back what was said. */
    sayWrite(refusal: string | null): void;
    /** Say at the form's end where the task goes, and what of that place to heed; none takes back what was said. */
    sayPlace(issues: readonly FormIssue<never>[]): void;
    /** Draw the create again as `HubHost.draft` says now: whether it may be asked, and whether one is under way. */
    showDraft(): void;
}

/**
 * What a hub on a task not written yet has that a hub on a row has not: the
 * create, which writes the task as the fields hold it, and whether anything
 * was given that a close would lose.
 */
export interface HubDraft {
    /** Whether a create may be asked now: the place has answered, the task can go there, and none is under way. */
    canCreate(): boolean;
    /** Whether a create is under way: its write not yet answered. */
    creating(): boolean;
    /** Write the task as it stands now; asked once the form has put in what is typed. The hub closes once it is written. */
    create(): void;
    /** Whether a write now would write anything other than the task as it opened: what a close asks about throwing away. */
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
     * The task not written yet, and its create. Null for a host that writes
     * what is handed on as it comes (a row the note has): nothing to create,
     * and nothing a close loses but what cannot be saved.
     */
    readonly draft: HubDraft | null;
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

/** A hub's host as its panel sees it: the form's host, told when the hub has opened and when it has closed. */
export interface PanelHost extends HubHost {
    /** The hub has opened in `panel`: what the host follows from now on is drawn there. */
    attach(panel: HubPanel): void;
    /** The hub has closed: the host follows nothing more, and a refusal that comes after is told by a notice. */
    dispose(): void;
}
