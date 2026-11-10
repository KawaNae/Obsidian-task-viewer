import type { App } from 'obsidian';
import { t } from '../../i18n';
import { logWarn } from '../../log/log';
import { frameLinkNames } from '../../services/data/MarkdownFrameNotes';
import { frameHeadings, frameTarget, noteFrameLink } from '../../services/data/MarkdownFrames';
import { NoteName, type NoteAsk } from '../../services/data/NoteName';
import { splitLines } from '../../services/persistence/FileLines';
import { headingKey, headingNames, type HeadingLink } from '../../services/parsing/utils/HeadingLinks';
import type { OutlineHeading } from '../../services/parsing/utils/Outline';
import type { FormIssue } from '../form/FormIssue';

/**
 * The section dialog: a note, and a heading of it or the whole note, chosen
 * for a markdown frame of the sidebar, to add the frame or to have a frame
 * show another section. This is its logic, apart from the DOM: which note
 * the note field names, the headings the heading field offers, which
 * section the fields name and the link that names it, what it says of each
 * field, and whether a choice may be made. What it looks like is the
 * surface's (`SectionModal`).
 *
 * - The note is found as the send dialog's is (`NoteName.find`): the note
 *   picked, the one note by a name, the note at a path or the one whose
 *   path ends in it. A name no note has, or more than one note has, names
 *   none, and nothing can be chosen until one is picked. Nor can it be for a
 *   note no link names (`frameLinkNames`: a path with a `#`).
 * - The heading field offers the whole note first, then the note's
 *   headings, each as deep as the headings it stands under. A heading no
 *   subpath names (`headingLinks`) is offered but cannot be picked.
 * - The heading field left empty names the whole note. A heading picked
 *   names that heading while the field holds what the pick put in and the
 *   note is the one it was picked in; anything else typed names the first
 *   heading of its name, compared as a link compares them (`headingKey`).
 * - The link is the note's path and the heading's subpath
 *   (`noteFrameLink`), the subpath being the one `headingLinks` gives: a
 *   link written here is read back as the section chosen.
 * - What the note is, is asked of the vault whenever the note field
 *   changes (`SectionHost.note`), and only the answer to the last asking is
 *   taken: a choice is not offered until the answer is for what the field
 *   holds now.
 */

/** What the dialog's issues are said of: the note field, or the heading field. */
export type SectionDialogField = 'note' | 'heading';

/**
 * What the heading field holds: the text, and the heading a pick from its
 * list named, by the note it was picked in and the heading's line there,
 * while the text is what the pick put in.
 */
export interface HeadingAsk {
    text: string;
    picked: { path: string; line: number } | null;
}

/** What the dialog's fields hold. */
export interface SectionAsk {
    note: NoteAsk;
    heading: HeadingAsk;
}

/**
 * The note the note field names: none while it is empty, a name no note has
 * (`missing`), more than one note (`ambiguous`, by their paths), a note no
 * link names (`unlinkable`), or the note, with its headings and the subpath
 * that names each.
 */
export type SectionNote =
    | { kind: 'empty' }
    | { kind: 'missing'; name: string }
    | { kind: 'ambiguous'; name: string; paths: readonly string[] }
    | { kind: 'unlinkable'; path: string }
    | { kind: 'note'; path: string; headings: readonly HeadingLink[] };

/**
 * What the heading field offers: the whole note, or a heading, with the
 * texts of the headings it stands under (`above`, outermost first) and the
 * subpath that names it, null for one no subpath names, which cannot be
 * picked.
 */
export type SectionChoice =
    | { kind: 'note' }
    | { kind: 'heading'; heading: OutlineHeading; above: readonly string[]; subpath: string | null };

/**
 * The section the fields name in a note: the whole note, a heading and the
 * subpath that names it, a heading no subpath names (`unlinkable`), or no
 * heading of the text typed (`no-heading`).
 */
export type ChosenSection =
    | { kind: 'note' }
    | { kind: 'heading'; heading: OutlineHeading; subpath: string }
    | { kind: 'unlinkable'; heading: OutlineHeading }
    | { kind: 'no-heading'; text: string };

/** What the surface shows. */
export interface SectionViewState {
    /** The path of the note the fields name, whose headings `choices` are; null while they name none. */
    path: string | null;
    /** What the heading field offers; none while the fields name no note. */
    choices: readonly SectionChoice[];
    issues: readonly FormIssue<SectionDialogField>[];
    canChoose: boolean;
}

export interface SectionSurface {
    render(state: SectionViewState): void;
}

export interface SectionHost {
    /** The note the note field names ({@link readSectionNote}). */
    note(ask: NoteAsk): Promise<SectionNote>;
    /** A section was chosen: the link that names it. */
    chosen(link: string): void;
    /** Close the dialog. */
    close(): void;
}

/** The note `ask` names, and its headings, read off its lines. */
export async function readSectionNote(app: Pick<App, 'vault' | 'metadataCache'>, ask: NoteAsk): Promise<SectionNote> {
    const name = ask.text.trim();
    if (name === '' && ask.picked === null) return { kind: 'empty' };
    // A name no note has is not a new note here: the folder it would be made in does not matter.
    const at = NoteName.find(app.vault, ask, '');
    switch (at.kind) {
        case 'new':
            return { kind: 'missing', name };
        case 'ambiguous':
            return { kind: 'ambiguous', name: at.name, paths: at.files.map(file => file.path) };
        case 'existing': {
            // The link is the frame's whatever section is chosen: its note is
            // the part before the first `#`, which no heading's subpath changes.
            if (!frameLinkNames(app.metadataCache, noteFrameLink(at.file.path, null), at.file)) {
                return { kind: 'unlinkable', path: at.file.path };
            }
            const { lines } = splitLines(await app.vault.cachedRead(at.file));
            return { kind: 'note', path: at.file.path, headings: frameHeadings(lines) };
        }
    }
}

/** What the heading field offers for a note of `headings`: the whole note, then each heading, with the headings it stands under. */
export function sectionChoices(headings: readonly HeadingLink[]): SectionChoice[] {
    const above: OutlineHeading[] = [];
    const out: SectionChoice[] = [{ kind: 'note' }];
    for (const { heading, subpath } of headings) {
        while (above.length > 0 && above[above.length - 1].level >= heading.level) above.pop();
        out.push({ kind: 'heading', heading, above: above.map(h => h.text), subpath });
        above.push(heading);
    }
    return out;
}

/**
 * The choices offered for `query`, in their order: all of them for an empty
 * one, else the headings whose text holds it, case aside. The whole note is
 * what an empty field names, so it is offered with nothing typed.
 */
export function offeredChoices(choices: readonly SectionChoice[], query: string): SectionChoice[] {
    const lower = query.trim().toLowerCase();
    if (lower === '') return [...choices];
    return choices.filter(choice => choice.kind === 'heading' && choice.heading.text.toLowerCase().includes(lower));
}

/** The section the heading field `ask` names in the note at `path`, of `headings`. */
export function chosenSection(path: string, headings: readonly HeadingLink[], ask: HeadingAsk): ChosenSection {
    if (ask.text.trim() === '') return { kind: 'note' };
    const { picked } = ask;
    const key = headingKey(ask.text);
    const named = (picked && picked.path === path ? headings.find(one => one.heading.line === picked.line) : undefined)
        ?? headings.find(one => headingKey(one.heading.text) === key);
    if (!named) return { kind: 'no-heading', text: ask.text.trim() };
    return named.subpath === null
        ? { kind: 'unlinkable', heading: named.heading }
        : { kind: 'heading', heading: named.heading, subpath: named.subpath };
}

/** The link of the section `chosen` of the note at `path`; null for one no link names. */
export function sectionLink(path: string, chosen: ChosenSection): string | null {
    switch (chosen.kind) {
        case 'note': return noteFrameLink(path, null);
        case 'heading': return noteFrameLink(path, chosen.subpath);
        default: return null;
    }
}

/**
 * `heading` as it stands in the note: the texts of the headings it stands
 * under, outermost first, and its own, joined by `›`. Of two headings of one
 * text, this tells which the fields name.
 */
export function headingTrail(headings: readonly HeadingLink[], heading: OutlineHeading): string {
    const choice = sectionChoices(headings).find(one => one.kind === 'heading' && one.heading === heading);
    return trailOf([...(choice?.kind === 'heading' ? choice.above : []), heading.text]);
}

/** The texts of headings, each under the one before it, as one line. */
export function trailOf(texts: readonly string[]): string {
    return texts.join(' › ');
}

/** The fields as a dialog to add a frame opens: empty. */
export function emptySectionAsk(): SectionAsk {
    return { note: { text: '', picked: null }, heading: { text: '', picked: null } };
}

/**
 * The fields as a dialog to choose again the section of the frame of `link`
 * opens: the note the frame found, picked, or the note its link names as
 * typed, when it found none; and the last heading the link names, as
 * typed, or nothing for the whole note.
 */
export function sectionAskOf(link: string, found: { path: string; basename: string } | null): SectionAsk {
    const { path, subpath } = frameTarget(link);
    const names = headingNames(subpath);
    return {
        note: found ? { text: found.basename, picked: found.path } : { text: path, picked: null },
        heading: { text: names.length > 0 ? names[names.length - 1] : '', picked: null },
    };
}

export class SectionDialog {
    private ask: SectionAsk;
    /** How many times the note was asked: an answer is taken only to the last. */
    private asked = 0;
    private answer: { seq: number; note: SectionNote } | null = null;
    private disposed = false;

    constructor(
        initial: SectionAsk,
        private readonly host: SectionHost,
        private readonly surface: SectionSurface,
    ) {
        this.ask = { note: { ...initial.note }, heading: { ...initial.heading } };
        void this.lookUp();
    }

    /** The note field changed: the note is asked again. */
    noteChanged(note: NoteAsk): void {
        this.ask = { ...this.ask, note: { ...note } };
        void this.lookUp();
    }

    /** The heading field changed. */
    headingChanged(heading: HeadingAsk): void {
        this.ask = { ...this.ask, heading: { ...heading } };
        this.render();
    }

    /**
     * What the surface shows: of the note last answered, while the note
     * field is asked again too, so the heading field's list does not empty
     * at each key. A choice is offered only once the answer is for what the
     * field holds now.
     */
    state(): SectionViewState {
        const note = this.answer?.note ?? null;
        const issues: FormIssue<SectionDialogField>[] = [];
        const say = (at: SectionDialogField, tone: FormIssue<SectionDialogField>['tone'], text: string) => issues.push({ at, tone, text });

        switch (note?.kind) {
            case 'missing':
                say('note', 'error', t('modal.section.noteMissing', { name: note.name }));
                break;
            case 'ambiguous':
                say('note', 'error', t('modal.noteAmbiguous', { name: note.name, count: String(note.paths.length), notes: note.paths.join(', ') }));
                break;
            case 'unlinkable':
                say('note', 'error', t(note.path.includes('#') ? 'modal.section.noteUnlinkableHash' : 'modal.section.noteUnlinkable', { note: note.path }));
                break;
        }
        if (note?.kind !== 'note') return { path: null, choices: [], issues, canChoose: false };

        say('note', 'info', t('modal.section.note', { note: note.path }));
        const chosen = chosenSection(note.path, note.headings, this.ask.heading);
        switch (chosen.kind) {
            case 'note':
                say('heading', 'info', t('modal.section.wholeNoteShown'));
                break;
            case 'heading':
                say('heading', 'info', t('modal.section.headingShown', { heading: headingTrail(note.headings, chosen.heading) }));
                break;
            case 'unlinkable':
                say('heading', 'error', t('modal.section.unlinkable', { heading: chosen.heading.text }));
                break;
            case 'no-heading':
                say('heading', 'error', t('modal.section.noHeading', { note: note.path, heading: chosen.text }));
                break;
        }
        return {
            path: note.path,
            choices: sectionChoices(note.headings),
            issues,
            canChoose: this.caughtUp() && sectionLink(note.path, chosen) !== null,
        };
    }

    /** The link of the section the fields name now; null while they name none, or the answer is not for them yet. */
    link(): string | null {
        const note = this.caughtUp() ? this.answer!.note : null;
        if (note?.kind !== 'note') return null;
        return sectionLink(note.path, chosenSection(note.path, note.headings, this.ask.heading));
    }

    /** Choose the section the fields name: the button, or Enter. Nothing is done while they name none. */
    choose(): void {
        const link = this.link();
        if (link === null || this.disposed) return;
        this.host.chosen(link);
        this.host.close();
    }

    dispose(): void {
        this.disposed = true;
    }

    /** Ask which note the note field names; the answer is taken only if no asking came after. */
    private async lookUp(): Promise<void> {
        const seq = ++this.asked;
        this.render();
        let note: SectionNote;
        try {
            note = await this.host.note({ ...this.ask.note });
        } catch (e) {
            logWarn(`[SectionDialog] the note could not be read: ${String(e)}`);
            return;
        }
        if (this.disposed || seq !== this.asked) return;
        this.answer = { seq, note };
        this.render();
    }

    /** Whether the note answered is the one the note field names now. */
    private caughtUp(): boolean {
        return this.answer !== null && this.answer.seq === this.asked;
    }

    private render(): void {
        if (this.disposed) return;
        this.surface.render(this.state());
    }
}
