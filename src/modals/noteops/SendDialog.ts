import { t } from '../../i18n';
import { logWarn } from '../../log/log';
import type { InheritedValue } from '../../services/data/InheritedValues';
import type {
    DestinationAsk, DestinationFacts, NoteFacts, SendingLines, SendPreview, SendRequest, SendResult, SendRow,
} from '../../services/data/NoteOps';
import { sendingOf } from '../../services/data/NoteOps';
import type { AnchorLink } from '../../services/data/NoteRefs';
import type { UnresolvedReference } from '../../services/flow/FlowReferences';
import type { ValueSource } from '../../services/parsing/tree/DocumentTree';
import { Outline } from '../../services/parsing/utils/Outline';
import { SubtreeFrame, type DraftCheck } from '../../services/persistence/utils/SubtreeFrame';
import type { DraftEditor } from '../form/source/SourceEditor';

/**
 * The send dialog: rows and their subtrees sent to a section of a note
 * (note-ops-plan.md 4). This is its logic, apart from the DOM: what it
 * opens on, what it says of the destination the fields name, which values
 * it offers for the note's frontmatter, whether a send may be asked, what
 * a send asks, and whether the dialog may close. What it looks like is the
 * surface's (`SendModal`).
 *
 * - Each row opens in the source editor (`SubtreeFrame.open`), as the hub's
 *   source mode opens it. A row whose subtree does not open (`shallow`) is
 *   shown as its lines, moved to the first column, and goes as it stands.
 * - What the destination is, is asked of the vault whenever a field
 *   changes (`SendHost.facts`), and only the answer to the last asking is
 *   taken: a send is not offered until the answer is for what the fields
 *   hold now.
 * - The values offered for the frontmatter are checked by default but
 *   Obsidian's own keys; a check the user changed stays as they left it
 *   whichever note the fields name. A key the note has already is not
 *   written, and is offered as such. The rows' own note is offered none.
 * - The open timers are asked whether they let the send be made
 *   (`SendHost.timers`) whenever the dialog shows it, with the drafts as
 *   they are: a send that would leave a timer without its lines is not
 *   offered, and why is said. A timer that changes by itself while the
 *   dialog is open (an interval's record) is seen at the next showing; the
 *   send asks again as it is made.
 * - A send not made keeps the draft and says why under it; a send made
 *   closes the dialog. A send made for some rows only says why too, and
 *   offers no send again: the rows that went are no longer where the
 *   dialog opened them.
 * - A draft is never lost to a close the user asks for: the dialog asks
 *   first (`beforeClose`), as the hub's source mode does. A draft is a row
 *   whose editor holds other lines than it opened on (`SubtreeFrame.check`
 *   is not `same`); the fields are not asked about.
 */

/** Where the dialog is: open to a send, sending, or past a send made for some rows only. */
export type SendPhase = 'open' | 'sending' | 'spent';

/** A value offered for the note's frontmatter, as the surface lists it. */
export interface CandidateView {
    key: string;
    /** The value as the frontmatter will say it. */
    value: string;
    /** Where the rows inherit it from: the frontmatter, or a heading's section. */
    from: string;
    checked: boolean;
    /** Why it cannot be chosen; null when it can. */
    shut: string | null;
}

/** A sentence the dialog says, with how it says it (`tv-form__info`, `__warning`, `__error`). */
export type Tone = 'info' | 'warning' | 'error';

/** What the surface shows. */
export interface SendViewState {
    phase: SendPhase;
    /** What the send does, in one sentence; null until the fields name a note the send can go to. */
    destination: { text: string; tone: Tone } | null;
    /** The headings of the note the fields name, for the heading field to offer. */
    headings: readonly string[];
    /** The values offered for the frontmatter; null when none is offered. */
    candidates: readonly CandidateView[] | null;
    /** Why a send cannot be asked. */
    errors: readonly string[];
    /** What a send can be asked in spite of. */
    warnings: readonly string[];
    /** The fields said wrong by an error. */
    invalid: { name: boolean; heading: boolean };
    /** Under the fields: why the last send was not made, or made for some rows only. */
    message: string | null;
    canSend: boolean;
    /** Asking whether to throw the draft away. */
    asking: boolean;
}

export interface SendSurface {
    /** Open an editor on a row's subtree, in the order of the rows: `submit` on Mod+Enter, `edited` on a change of its text. */
    openEditor(frame: SubtreeFrame, hooks: { submit(): void; edited(): void }): DraftEditor;
    /** Show a row the editor cannot open, in the order of the rows: its lines as they go, and why. */
    showFixed(lines: readonly string[], why: string): void;
    render(state: SendViewState): void;
    /** The question whether to throw the draft away was put, first or again: the focus goes to its answer that keeps the draft. */
    asked(): void;
}

export interface SendHost {
    /** What the destination the fields name is (`NoteOps.destinationFacts`). */
    facts(ask: DestinationAsk): Promise<DestinationFacts>;
    /** Why the open timers keep the send `sending` from being made, in one sentence; null when nothing keeps it (`NoteOps.timersRefuse`). */
    timers(sending: SendingLines): string | null;
    /** Make the send (`NoteOps.send`), a send not made shown here rather than in a notice. */
    send(req: SendRequest): Promise<SendResult>;
    /** A new level of indentation, as Obsidian's settings say (`ObsidianConfig.indentUnit`). */
    indentUnit(): string;
    /** The rows went, all or some: what the caller does once they left where they stood. */
    sent(result: Exclude<SendResult, { kind: 'not-done' }>): void;
    /** Close the dialog, asking nothing more. */
    close(): void;
}

/** A row as the dialog opened it: in an editor, or as it stands. */
type OpenedRow =
    | { kind: 'editor'; taskId: string; frame: SubtreeFrame; editor: DraftEditor }
    | { kind: 'fixed'; taskId: string; base: readonly string[] };

/** Obsidian's own keys are `InheritedValue.obsidian`: not checked unless the user checks them. */
function checkedByDefault(candidate: InheritedValue): boolean {
    return !candidate.obsidian;
}

export class SendDialog {
    private readonly rows: OpenedRow[] = [];
    private phase: SendPhase = 'open';
    private ask: DestinationAsk;
    /** How many times the destination was asked: an answer is taken only to the last. */
    private asked = 0;
    private answer: { seq: number; facts: DestinationFacts } | null = null;
    /** The checks the user changed, by key. */
    private readonly checks = new Map<string, boolean>();
    private message: string | null = null;
    private asking = false;
    private disposed = false;

    constructor(
        private readonly preview: SendPreview,
        private readonly host: SendHost,
        private readonly surface: SendSurface,
    ) {
        this.ask = initialAsk(preview);
        for (const row of preview.rows) {
            const base = row.task.subtreeLines ?? row.lines.slice(row.task.line, row.task.line + 1);
            const opening = SubtreeFrame.open(base, host.indentUnit());
            if (opening.open) {
                const editor = surface.openEditor(opening.frame, {
                    submit: () => { void this.send(); },
                    edited: () => this.edited(),
                });
                this.rows.push({ kind: 'editor', taskId: row.task.id, frame: opening.frame, editor });
            } else {
                surface.showFixed(atFirstColumn(base), t('modal.send.shallow', { line: String(opening.line) }));
                this.rows.push({ kind: 'fixed', taskId: row.task.id, base });
            }
        }
        void this.lookUp();
    }

    /** The fields changed: the destination is asked again. */
    fieldsChanged(ask: DestinationAsk): void {
        this.ask = { ...ask };
        void this.lookUp();
    }

    /** The user checked or unchecked the value `key` offered. */
    check(key: string, checked: boolean): void {
        this.checks.set(key, checked);
        this.render();
    }

    state(): SendViewState {
        const facts = this.answer?.facts ?? null;
        const errors: string[] = [];
        const warnings: string[] = [];
        const invalid = { name: false, heading: false };

        if (facts?.kind === 'unnamed') {
            invalid.name = true;
            errors.push(nameError(facts.why));
        } else if (facts && facts.heading.kind === 'many') {
            invalid.heading = true;
            errors.push(t('modal.send.headings', { note: facts.path, heading: facts.to.section.heading, count: String(facts.heading.count) }));
        }
        for (const why of new Set(this.drafts().flatMap(({ check }) => (check?.kind === 'refused' ? [draftError(check.reason)] : [])))) {
            errors.push(why);
        }
        const timers = this.timersRefuse(facts);
        if (timers !== null) errors.push(timers);
        if (facts && facts.kind !== 'unnamed') warnings.push(...this.warningsOf(facts));

        return {
            phase: this.phase,
            destination: facts && facts.kind !== 'unnamed' ? destinationText(facts) : null,
            headings: facts && facts.kind !== 'unnamed' ? facts.headings : [],
            candidates: this.candidatesOf(facts),
            errors,
            warnings,
            invalid,
            message: this.message,
            canSend: this.phase === 'open' && this.caughtUp() && errors.length === 0,
            asking: this.asking,
        };
    }

    /** Send as the dialog holds it: the send button, or Mod+Enter. Asked whether to throw the draft away, the question is withdrawn. */
    async send(): Promise<void> {
        const req = this.request();
        if (!req || !this.state().canSend) return;
        this.asking = false;
        this.phase = 'sending';
        this.message = null;
        this.render();

        const result = await this.host.send(req);
        if (this.disposed) return;
        if (result.kind === 'done') {
            this.host.sent(result);
            return this.host.close();
        }
        this.message = result.why;
        if (result.kind === 'partly') {
            this.phase = 'spent';
            this.render();
            return this.host.sent(result);
        }
        this.phase = 'open';
        // The note may have changed under the send: its headings, its keys.
        void this.lookUp();
    }

    /**
     * What a send asks now (see {@link SendRequest}): each row as the dialog
     * opened it, with its draft when its editor holds one; where the fields
     * name, as last answered; and the values checked the note has none of,
     * none for the rows' own note. Null while the fields name no note, or a
     * draft cannot be written.
     */
    request(): SendRequest | null {
        const facts = this.answer?.facts;
        if (!facts || facts.kind === 'unnamed') return null;
        const rows: SendRow[] = [];
        for (const { row, check } of this.drafts()) {
            if (check?.kind === 'refused') return null;
            const base = row.kind === 'editor' ? row.frame.base : row.base;
            rows.push(check?.kind === 'write'
                ? { taskId: row.taskId, base, draft: check.replacement }
                : { taskId: row.taskId, base });
        }
        return {
            rows,
            to: facts.to,
            frontmatter: facts.kind === 'same' ? [] : this.preview.candidates.filter(one => this.isChecked(one) && !facts.present.includes(one.key)),
        };
    }

    /**
     * Whether the dialog may close now (`OverlayShell` asks it before a
     * close the user asked for). Not while a row's editor holds a draft: the
     * dialog asks whether to throw it away, and closes if the user says so.
     * Asked again while it asks, the question is put again.
     */
    beforeClose(): boolean {
        if (!this.asking && !this.hasDraft()) return true;
        const drawn = this.asking;
        this.asking = true;
        if (!drawn) this.render();
        this.surface.asked();
        return false;
    }

    /** Throw the draft away, as asked, and close. */
    discard(): void {
        this.asking = false;
        this.host.close();
    }

    /** Keep the draft: the question is withdrawn. */
    keep(): void {
        if (!this.asking) return;
        this.asking = false;
        this.render();
        this.firstEditor()?.focus();
    }

    /** Whether an Escape is an editor's own (a completion list to close), not the dialog's. */
    yieldsEscape(): boolean {
        return this.editors().some(editor => editor.isCompleting());
    }

    /** The back as an editor's own: a completion list closes, as on Escape. Whether one took it. */
    takesBack(): boolean {
        return this.editors().map(editor => editor.closeCompletion()).some(Boolean);
    }

    /** The editor the dialog focuses as it opens; none when no row opened in one. */
    firstEditor(): DraftEditor | null {
        return this.editors()[0] ?? null;
    }

    dispose(): void {
        this.disposed = true;
        for (const editor of this.editors()) editor.destroy();
    }

    /** Ask what the destination the fields name is; the answer is taken only if no asking came after. */
    private async lookUp(): Promise<void> {
        const seq = ++this.asked;
        this.render();
        let facts: DestinationFacts;
        try {
            facts = await this.host.facts({ ...this.ask });
        } catch (e) {
            logWarn(`[SendDialog] the destination could not be read: ${String(e)}`);
            return;
        }
        if (this.disposed || seq !== this.asked) return;
        this.answer = { seq, facts };
        this.render();
    }

    /** Whether the destination answered is the one the fields name now. */
    private caughtUp(): boolean {
        return this.answer !== null && this.answer.seq === this.asked;
    }

    /** A draft's text changed: asked whether to throw it away, the question is withdrawn. */
    private edited(): void {
        this.asking = false;
        this.render();
    }

    private editors(): DraftEditor[] {
        return this.rows.flatMap(row => (row.kind === 'editor' ? [row.editor] : []));
    }

    /** Each row, and what its editor's draft comes to; no check for a row shown as it stands. */
    private drafts(): { row: OpenedRow; check: DraftCheck | null }[] {
        return this.rows.map(row => ({ row, check: row.kind === 'editor' ? row.frame.check(row.editor.draft()) : null }));
    }

    private hasDraft(): boolean {
        return this.drafts().some(({ check }) => check !== null && check.kind !== 'same');
    }

    private isChecked(candidate: InheritedValue): boolean {
        return this.checks.get(candidate.key) ?? checkedByDefault(candidate);
    }

    /** The values offered, as the note the fields name has them; none for the rows' own note. */
    private candidatesOf(facts: DestinationFacts | null): CandidateView[] | null {
        if (facts?.kind === 'same' || this.preview.candidates.length === 0) return null;
        const present = facts && facts.kind !== 'unnamed' ? facts : null;
        return this.preview.candidates.map((one): CandidateView => {
            const has = present?.present.includes(one.key) ?? false;
            return {
                key: one.key,
                value: yamlValue(one.yaml),
                from: one.from.map(sourceLabel).join(t('modal.send.fromJoin')),
                checked: has ? false : this.isChecked(one),
                shut: has ? t('modal.send.present', { note: present!.path }) : null,
            };
        });
    }

    /**
     * Why the open timers keep a send to the note `facts` names from being
     * made, the rows as their editors hold them; null when nothing keeps it,
     * or the fields name no note, or a draft cannot be written (said
     * already).
     */
    private timersRefuse(facts: DestinationFacts | null): string | null {
        const req = this.request();
        if (!req || !facts || facts.kind === 'unnamed') return null;
        const rows = req.rows.map((row, i) => ({ ...row, file: this.preview.rows[i].task.file }));
        return this.host.timers(sendingOf(rows, facts.path, facts.anchors));
    }

    private warningsOf(facts: NoteFacts): string[] {
        const out: string[] = facts.unresolved.map(one => unresolvedText(one, facts.path));
        if (facts.kind !== 'same') {
            for (const [anchor, notes] of linksByAnchor(this.preview.links)) {
                out.push(t('modal.send.links', { anchor, count: String(notes.length), notes: notes.join(', ') }));
            }
        }
        for (const anchor of facts.shared) out.push(t('modal.send.shared', { anchor, note: facts.path }));
        if (facts.ignored) out.push(t('modal.send.ignored', { note: facts.path }));
        if (facts.namesakes.length > 0) out.push(t('modal.send.namesakes', { notes: facts.namesakes.map(file => file.path).join(', ') }));
        return out;
    }

    private render(): void {
        if (this.disposed) return;
        this.surface.render(this.state());
    }
}

/**
 * The fields as a dialog on `preview` opens: the default note's name and
 * folder, and the heading field empty, which stands for the settings'
 * heading (`SendPreview.defaults`).
 */
export function initialAsk(preview: SendPreview): DestinationAsk {
    const { note } = preview.defaults;
    if (note.kind === 'new') return { folder: note.folder, name: note.name, heading: '' };
    const cut = note.path.lastIndexOf('/');
    return {
        folder: cut < 0 ? '' : note.path.slice(0, cut),
        name: note.path.slice(cut + 1).replace(/\.md$/i, ''),
        heading: '',
    };
}

/** What a send to `facts` does, in one sentence, by where the rows go in the section (its side). */
export function destinationText(facts: NoteFacts): { text: string; tone: Tone } | null {
    const vars = { note: facts.path, heading: facts.to.section.heading };
    const end = facts.to.section.side === 'end';
    switch (facts.kind) {
        case 'new':
            return { text: t('modal.send.toNew', vars), tone: 'info' };
        case 'existing':
            if (facts.heading.kind === 'many') return null;
            if (facts.heading.kind === 'none') return { text: t('modal.send.toMade', vars), tone: 'warning' };
            return { text: t(end ? 'modal.send.toEnd' : 'modal.send.toHead', vars), tone: 'warning' };
        case 'same':
            if (facts.heading.kind === 'many') return null;
            if (facts.heading.kind === 'none') return { text: t('modal.send.withinMade', vars), tone: 'info' };
            return { text: t(end ? 'modal.send.withinEnd' : 'modal.send.withinHead', vars), tone: 'info' };
    }
}

function nameError(why: Extract<DestinationFacts, { kind: 'unnamed' }>['why']): string {
    switch (why.why) {
        case 'empty': return t('modal.send.nameEmpty');
        case 'chars': return t('modal.send.nameChars', { chars: why.chars });
        case 'dot': return t('modal.send.nameDot');
    }
}

function draftError(reason: Extract<DraftCheck, { kind: 'refused' }>['reason']): string {
    return reason === 'parent-break' ? t('modal.send.parentBreak') : t('modal.send.notTask');
}

function unresolvedText(one: UnresolvedReference, note: string): string {
    if (one.kind === 'block') return t('modal.send.unresolvedBlock', { name: one.name, note });
    return t(one.found === 'many' ? 'modal.send.unresolvedHeadings' : 'modal.send.unresolvedHeading', { name: one.name, note });
}

/** The notes that link to each `^id`, each note once, the ids in the order their first link comes. */
function linksByAnchor(links: readonly AnchorLink[]): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const link of links) {
        const notes = out.get(link.anchor) ?? [];
        if (!notes.includes(link.from)) notes.push(link.from);
        out.set(link.anchor, notes);
    }
    return out;
}

function sourceLabel(from: ValueSource): string {
    if (from.kind === 'frontmatter') return t('modal.send.fromFrontmatter');
    return from.heading ? t('modal.send.fromHeading', { heading: from.heading.text }) : t('modal.send.fromTop');
}

/**
 * A key's frontmatter lines as its value reads: what follows the key on its
 * line, as written (quotes and all), or the items of a list under it.
 */
export function yamlValue(yaml: readonly string[]): string {
    const [first = '', ...rest] = yaml;
    const onLine = first.match(/^(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^:]*):\s*(.*)$/)?.[1] ?? first;
    if (rest.length === 0) return onLine;
    const items = rest.map(line => line.trim().replace(/^- /, ''));
    return onLine === '' ? items.join(', ') : [onLine, ...items].join(' ');
}

/** A subtree's lines as they read from the row: the row's indentation taken off every line. */
function atFirstColumn(base: readonly string[]): string[] {
    const indent = Outline.indentOf(base[0]);
    return base.map(line => (Outline.isBlank(line) ? '' : Outline.shiftIndent(line, indent, '')));
}
