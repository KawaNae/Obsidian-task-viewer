import { parseYaml } from 'obsidian';
import { t } from '../../i18n';
import { logError, logWarn } from '../../log/log';
import type { InheritedValue } from '../../services/data/InheritedValues';
import type {
    DestinationFacts, NoteFacts, SendingLines, SendPreview, SendRequest, SendResult, SendRow,
} from '../../services/data/NoteOps';
import type { DestinationAsk } from '../../services/data/NotePlaces';
import { sendingOf } from '../../services/data/NoteOps';
import type { AnchorLink } from '../../services/data/NoteRefs';
import type { UnresolvedReference } from '../../services/flow/FlowReferences';
import type { ValueSource } from '../../services/parsing/tree/Sections';
import { Outline } from '../../services/parsing/utils/Outline';
import { PropertyLines } from '../../services/parsing/utils/PropertyLines';
import { PropertyValues } from '../../services/parsing/utils/PropertyValues';
import type { SubtreeReplacement } from '../../services/persistence/TaskOps';
import type { FormIssue, Tone } from '../form/FormIssue';
import { LastAnswer } from '../form/LastAnswer';
import { DestinationText } from './DestinationText';

/**
 * The send dialog: rows and their subtrees sent to a section of a note, or
 * to its end.
 * This is its logic, apart from the DOM: what it
 * opens on, what it says of the destination the fields name, which values
 * it offers to write into the note, whether a send may be asked, what
 * a send asks, and what its answer does. What it looks like is the
 * surface's, and the rows' drafts are its host's: it holds no editor.
 *
 * - Each row goes as it opened (`SendRow.base`), with the draft the host
 *   holds for it as it is when asked (`SendHost.drafts`): as a send is
 *   asked, as what the dialog says is drawn, and as the timers are asked.
 * - What the destination is, is asked of the vault whenever a field
 *   changes (`SendHost.facts`), and only the answer to the last asking is
 *   taken: a send is not offered until the answer is for what the fields
 *   hold now.
 * - The values offered to write into the note are checked by default; a
 *   check the user changed stays as they left it whichever note the fields
 *   name. Each says where it is written (`CandidateView.to`): a built-in
 *   into the frontmatter, a custom property on a line above the first
 *   heading. A key the note says already is not written (`NoteFacts.present`),
 *   and is offered as such. The rows' own note is offered none.
 * - The open timers are asked whether they let the send be made
 *   (`SendHost.timers`) whenever the dialog shows it, with the drafts as
 *   they are: a send that would leave a timer without its lines is not
 *   offered, and why is said. A timer that changes by itself while the
 *   dialog is open (an interval's record) is seen at the next showing; the
 *   send asks again as it is made.
 * - What the dialog says is of a field or the form (`FormIssue`):
 *   under the note, which note the rows go to, always: the note there is,
 *   the rows' own note, or the note the send makes (and its folder), or why
 *   the field names none — a name or a path no note can be made at, or more
 *   than one note it does not tell apart; under the heading, where in the note they go, or why the
 *   heading names no one place; the rest (the timers, what a send is asked
 *   in spite of, the last send's answer) of the form. A send is asked only
 *   while no error is said of what the dialog holds, and the host holds a
 *   draft for every row that can be written; why one cannot is the host's
 *   to say. The answer to the last send keeps none from being asked again.
 * - A dialog on one row told where it stands (`SendOptions.stands`) does
 *   not send it there: the note it is in and the heading it stands under
 *   (the note's end for a row in a note with no heading). The send would
 *   still move it, to the section's head or end and out from under its
 *   parent. Said under the note, in place of where the row goes.
 * - A send not made, or one that threw, keeps the drafts and says why; a
 *   send made is told to the host, which closes what the dialog is shown
 *   in. A send made for some
 *   rows only says why too, and offers no send again: the rows that went
 *   are no longer where the dialog opened them.
 */

/** Where the dialog is: open to a send, sending, or past a send made for some rows only. */
export type SendPhase = 'open' | 'sending' | 'spent';

/** A value offered to write into the note, as the surface lists it. */
export interface CandidateView {
    key: string;
    /** Where it is written: the note's frontmatter, or a property line above its first heading. */
    to: InheritedValue['to'];
    /** The value the note will hold, read from the lines written (`yamlValue`, `lineValue`). */
    value: string;
    /** Where the rows inherit it from: the frontmatter, the lines above the first heading, or a heading's section. */
    from: string;
    checked: boolean;
    /** Why it cannot be chosen; null when it can. */
    shut: string | null;
}

/** What the dialog's issues are said of, besides the form: the note field, or the heading field. */
export type SendField = 'note' | 'heading';

/** What the surface shows. */
export interface SendViewState {
    phase: SendPhase;
    /** The headings of the note the fields name, for the heading field to offer. */
    headings: readonly string[];
    /** The values offered to write into the note, in the order the rows inherit them; null when none is offered. */
    candidates: readonly CandidateView[] | null;
    /**
     * What the dialog says: why a send cannot be asked (errors), what it can
     * be asked in spite of (warnings), what it does (the heading's info or
     * warning), and why the last send was not made, or made for some rows
     * only (an error of the form).
     */
    issues: readonly FormIssue<SendField>[];
    canSend: boolean;
}

export interface SendSurface {
    render(state: SendViewState): void;
}

/** Where a row stands: its note, and the heading it stands under, null above the note's first heading. */
export interface RowStand {
    note: string;
    heading: string | null;
}

/** What a dialog opens with besides its rows. */
export interface SendOptions {
    /** The fields as it opens; none: the preview's defaults (`initialAsk`). */
    initial?: DestinationAsk;
    /** Where the one row the dialog sends stands now: no send is asked there. None: every place may be sent to. */
    stands?: RowStand;
}

export interface SendHost {
    /** What the destination the fields name is (`NoteOps.destinationFacts`). */
    facts(ask: DestinationAsk): Promise<DestinationFacts>;
    /** Why the open timers keep the send `sending` from being made, in one sentence; null when nothing keeps it (`NoteOps.timersRefuse`). */
    timers(sending: SendingLines): string | null;
    /** Make the send (`NoteOps.send`), a send not made shown here rather than in a notice. */
    send(req: SendRequest): Promise<SendResult>;
    /**
     * Each row's draft as it is now, in the order of the rows: the
     * replacement of its subtree, or null where it goes as it opened. Null
     * while a draft cannot be written: no send is asked, and why is said by
     * the host, which holds the drafts.
     */
    drafts(): readonly (SubtreeReplacement | null)[] | null;
    /**
     * Whether the drafts hold all the host holds of the rows: not while it
     * holds a text not taken into them yet, which the send takes in first.
     * What is asked of the drafts' lines (the timers) is not asked
     * meanwhile: a send may be asked as where it goes and the rows say, and
     * the lines are asked of as the send is asked, on the drafts the text
     * made, why said as before where they keep it.
     */
    draftsTaken(): boolean;
    /** The send was made for every row: what the dialog is shown in goes, asking nothing more. */
    close(): void;
}

/** The lines a row of `preview` goes as when it has no draft: its subtree as the preview read it, or its line alone. */
function rowBase(row: SendPreview['rows'][number]): readonly string[] {
    return row.task.subtreeLines ?? row.lines.slice(row.task.line, row.task.line + 1);
}

export class SendDialog {
    /** Each row, by its name and the lines it opened as. */
    private readonly rows: readonly { taskId: string; base: readonly string[] }[];
    private phase: SendPhase = 'open';
    private ask: DestinationAsk;
    /** What the destination is, as last answered: an answer is taken only to the last asking. */
    private readonly answer = new LastAnswer<DestinationFacts>();
    /** The checks the user changed, by key. */
    private readonly checks = new Map<string, boolean>();
    private message: string | null = null;
    private disposed = false;

    constructor(
        private readonly preview: SendPreview,
        private readonly host: SendHost,
        private readonly surface: SendSurface,
        private readonly options: SendOptions = {},
    ) {
        this.ask = { ...(options.initial ?? initialAsk(preview)) };
        this.rows = preview.rows.map(row => ({ taskId: row.task.id, base: rowBase(row) }));
        void this.lookUp();
    }

    /** The fields changed: the destination is asked again. */
    fieldsChanged(ask: DestinationAsk): void {
        this.ask = { ...ask };
        void this.lookUp();
    }

    /** A row's draft changed: what the dialog says, and whether a send may be asked, is drawn again. */
    draftsChanged(): void {
        this.render();
    }

    /** The user checked or unchecked the value `key` offered. */
    check(key: string, checked: boolean): void {
        this.checks.set(key, checked);
        this.render();
    }

    state(): SendViewState {
        const facts = this.answer.value;
        const note = oneNote(facts);
        const held: FormIssue<SendField>[] = [];
        const error = (at: SendField | 'form', text: string) => held.push({ at, tone: 'error', text });

        if (facts?.kind === 'unnamed') {
            error('note', DestinationText.unnamed(facts));
        } else if (facts?.kind === 'ambiguous') {
            error('note', DestinationText.ambiguous(facts));
        } else if (note && note.to.spot !== 'end' && note.heading?.kind === 'many') {
            const { heading } = note.to.spot;
            error('heading', t('modal.send.headings', { note: note.path, heading, count: String(note.heading.count) }));
        }
        const timers = this.host.draftsTaken() ? this.timersRefuse(note) : null;
        if (timers !== null) error('form', timers);
        const stays = note !== null && this.staysAt(note);
        if (stays) {
            held.push({ at: 'note', tone: 'info', text: t('modal.send.samePlace') });
        } else if (note) {
            held.push(...noteText(note).map(says => ({ at: 'note' as const, ...says })));
            const says = headingText(note);
            if (says) held.push({ at: 'heading', ...says });
        }
        if (note) held.push(...this.warningsOf(note));
        const canSend = this.phase === 'open' && this.answer.caughtUp && this.host.drafts() !== null
            && !stays && !held.some(issue => issue.tone === 'error');

        return {
            phase: this.phase,
            headings: note?.headings ?? [],
            candidates: this.candidatesOf(note),
            issues: this.message === null ? held : [...held, { at: 'form', tone: 'error', text: this.message }],
            canSend,
        };
    }

    /**
     * The note the rows go to as the fields name it now: its path while the
     * answer for what they hold names one note (one there is, the rows'
     * own, or one the send makes); null while it is being read, or the
     * fields name none or more than one.
     */
    notePath(): string | null {
        return this.answer.caughtUp ? oneNote(this.answer.value)?.path ?? null : null;
    }

    /** Send as the dialog holds it, the drafts as they are now: nothing while a send may not be asked. */
    async send(): Promise<void> {
        const req = this.request();
        if (!req || !this.state().canSend) return;
        this.phase = 'sending';
        this.message = null;
        this.render();

        const result = await this.sent(req);
        if (this.disposed) return;
        if (result.kind === 'done') return this.host.close();
        this.message = result.why;
        if (result.kind === 'partly') {
            this.phase = 'spent';
            this.render();
            return;
        }
        this.phase = 'open';
        // The note may have changed under the send: its headings, its keys.
        void this.lookUp();
    }

    /**
     * The answer of the send `req`; one that threw is a send not made, said
     * as one the send's caller asked wrongly is, and written to the log.
     */
    private async sent(req: SendRequest): Promise<SendResult> {
        try {
            return await this.host.send(req);
        } catch (e) {
            logError(`[SendDialog] the send failed: ${e instanceof Error ? e.message : String(e)}`);
            return { kind: 'not-done', why: t('notice.notSent') };
        }
    }

    /**
     * What a send asks now (see {@link SendRequest}): each row as the dialog
     * opened it, with its draft where the host holds one; where the fields
     * name, as last answered; and the values checked the note has none of,
     * none for the rows' own note. Null while the fields name no one note,
     * or a draft cannot be written.
     */
    request(): SendRequest | null {
        const facts = oneNote(this.answer.value);
        const drafts = this.host.drafts();
        if (!facts || !drafts) return null;
        const rows: SendRow[] = this.rows.map(({ taskId, base }, i) => {
            const draft = drafts[i] ?? null;
            return draft ? { taskId, base, draft } : { taskId, base };
        });
        return {
            rows,
            to: facts.to,
            values: facts.kind === 'same' ? [] : this.preview.candidates.filter(one => this.isChecked(one) && !facts.present.includes(one.key)),
        };
    }

    /** What the dialog is shown in went: an answer or a result that comes after comes to nothing. */
    dispose(): void {
        this.disposed = true;
    }

    /** Ask what the destination the fields name is; the answer is taken only if no asking came after. */
    private async lookUp(): Promise<void> {
        const ask = { ...this.ask };
        const taking = this.answer.ask(() => this.host.facts(ask));
        this.render();
        try {
            if (!(await taking)) return;
        } catch (e) {
            logWarn(`[SendDialog] the destination could not be read: ${String(e)}`);
            return;
        }
        this.render();
    }

    /**
     * Whether a send to `facts` leaves the row where it stands: its own note,
     * under the heading it stands under. The note's end is where a row above
     * the first heading stands only in a note with no heading: in one with
     * headings, the end is in the last heading's section.
     */
    private staysAt(facts: NoteFacts): boolean {
        const stands = this.options.stands;
        if (!stands || facts.kind !== 'same' || facts.path !== stands.note) return false;
        const spot = facts.to.spot;
        if (spot === 'end') return stands.heading === null && facts.headings.length === 0;
        return spot.heading === stands.heading;
    }

    private isChecked(candidate: InheritedValue): boolean {
        return this.checks.get(candidate.key) ?? true;
    }

    /** The values offered, as the note the fields name has them; none for the rows' own note. */
    private candidatesOf(present: NoteFacts | null): CandidateView[] | null {
        if (present?.kind === 'same' || this.preview.candidates.length === 0) return null;
        return this.preview.candidates.map((one): CandidateView => {
            const has = present?.present.includes(one.key) ?? false;
            return {
                key: one.key,
                to: one.to,
                value: one.to === 'frontmatter' ? yamlValue(one.lines) : lineValue(one.lines),
                from: one.from.map(sourceLabel).join(t('modal.send.fromJoin')),
                checked: has ? false : this.isChecked(one),
                shut: has ? t('modal.send.present', { note: present!.path }) : null,
            };
        });
    }

    /**
     * Why the open timers keep a send to the note `facts` names from being
     * made, the rows as their drafts are; null when nothing keeps it,
     * or the fields name no one note, or a draft cannot be written (said
     * already).
     */
    private timersRefuse(facts: NoteFacts | null): string | null {
        const req = this.request();
        if (!req || !facts) return null;
        const rows = req.rows.map((row, i) => ({ ...row, file: this.preview.rows[i].task.file }));
        return this.host.timers(sendingOf(rows, facts.path, facts.anchors));
    }

    /**
     * What a send to `facts` can be asked in spite of: of the form, but the
     * namesakes of a note made at a path typed, which are of the note: once
     * made, neither note is told from the other by its name alone. A note
     * made by a name alone has none, as no note has its name.
     */
    private warningsOf(facts: NoteFacts): FormIssue<SendField>[] {
        const out: FormIssue<SendField>[] = [];
        const warn = (at: SendField | 'form', text: string) => out.push({ at, tone: 'warning', text });
        for (const one of facts.unresolved) warn('form', unresolvedText(one, facts.path));
        if (facts.kind !== 'same') {
            for (const [anchor, notes] of linksByAnchor(this.preview.links)) {
                warn('form', t('modal.send.links', { anchor, count: String(notes.length), notes: notes.join(', ') }));
            }
        }
        for (const anchor of facts.shared) warn('form', t('modal.send.shared', { anchor, note: facts.path }));
        if (facts.ignored) warn('form', t('modal.send.ignored', { note: facts.path }));
        const namesakes = facts.kind === 'new' ? DestinationText.namesakes(facts) : null;
        if (namesakes !== null) warn('note', namesakes);
        return out;
    }

    private render(): void {
        if (this.disposed) return;
        this.surface.render(this.state());
    }
}

/**
 * The fields as a dialog on `preview` opens, both as the preview says
 * (`SendPreview.defaults`): the note field, and the heading field holding
 * the settings' heading. Left untouched, the rows go where a task goes
 * when nothing names its heading; the heading field emptied sends them to
 * the note's end.
 */
export function initialAsk(preview: SendPreview): DestinationAsk {
    return { note: { ...preview.defaults.note }, heading: preview.defaults.section.heading };
}

/** The facts of the one note the fields name; null while they name none, or more than one. */
function oneNote(facts: DestinationFacts | null): NoteFacts | null {
    return facts && facts.kind !== 'unnamed' && facts.kind !== 'ambiguous' ? facts : null;
}

/**
 * Which note the rows go to, said under the note field: the note there is,
 * a warning, since the send writes into another note; the rows' own note;
 * or the note the send makes, a warning, so that a text typed to search
 * with is not sent to a new note unseen — and the folder it makes with it.
 */
export function noteText(facts: NoteFacts): { text: string; tone: Tone }[] {
    switch (facts.kind) {
        case 'existing':
            return [{ text: DestinationText.existing(facts.path), tone: 'warning' }];
        case 'same':
            return [{ text: t('modal.send.noteSame', { note: facts.path }), tone: 'info' }];
        case 'new':
            return DestinationText.made(facts);
    }
}

/**
 * Where in the note a send to `facts` puts the rows, in one sentence: at
 * the note's end, under no heading, or in the section, by where they go in
 * it (its side). A note there is but the rows' own is written into, a
 * warning, as under the note field. None while more than one heading goes
 * by the name: why is said instead.
 */
export function headingText(facts: NoteFacts): { text: string; tone: Tone } | null {
    const section = facts.to.spot;
    if (section === 'end') {
        switch (facts.kind) {
            case 'new': return { text: t('modal.send.toNewEnd'), tone: 'info' };
            case 'existing': return { text: t('modal.send.toNoteEnd'), tone: 'warning' };
            case 'same': return { text: t('modal.send.withinNoteEnd'), tone: 'info' };
        }
    }
    const found = facts.heading;
    if (found === null) return null;
    const vars = { heading: section.heading };
    const end = section.side === 'end';
    switch (facts.kind) {
        case 'new':
            return { text: t('modal.send.toNew', vars), tone: 'info' };
        case 'existing':
            if (found.kind === 'many') return null;
            if (found.kind === 'none') return { text: t('modal.send.toMade', vars), tone: 'warning' };
            return { text: t(end ? 'modal.send.toEnd' : 'modal.send.toHead', vars), tone: 'warning' };
        case 'same':
            if (found.kind === 'many') return null;
            if (found.kind === 'none') return { text: t('modal.send.withinMade', vars), tone: 'info' };
            return { text: t(end ? 'modal.send.withinEnd' : 'modal.send.withinHead', vars), tone: 'info' };
    }
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
 * A key's frontmatter lines as the value they hold reads: the lines read
 * as YAML, as the note will read them, and the value said bare. A string
 * without its quotes, a date as its text, a list as its items joined with
 * `, `, a number or a boolean as YAML says it. The lines are what is
 * written (`InheritedValue.yaml`), so what is shown is what the note gets,
 * however the lines spell it. Lines YAML does not read, or a mapping, are
 * shown as written after the key.
 */
export function yamlValue(yaml: readonly string[]): string {
    try {
        const read: unknown = parseYaml(yaml.join('\n'));
        if (read && typeof read === 'object' && !Array.isArray(read)) {
            const values = Object.values(read);
            if (values.length === 1) {
                const shown = scalarText(values[0]) ?? listText(values[0]);
                if (shown !== null) return shown;
            }
        }
    } catch {
        // shown as written, below
    }
    return writtenValue(yaml);
}

/**
 * A property line and the items under it as the value they hold reads, as
 * the note will read them (`PropertyLines`): a text without its quotes, a
 * list as its items joined with `, ` (`PropertyValues.display`).
 */
export function lineValue(lines: readonly string[]): string {
    const [line] = PropertyLines.ofSection(Outline.read(lines), null, 0, lines.length).lines;
    return line ? PropertyValues.display(line.value) : lines.join(' ');
}

/** A YAML scalar as its value reads; null for a list or a mapping. */
function scalarText(value: unknown): string | null {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    return null;
}

/** A YAML list of scalars as its items joined; null for anything else. */
function listText(value: unknown): string | null {
    if (!Array.isArray(value)) return null;
    const items = value.map(scalarText);
    return items.every((item): item is string => item !== null) ? items.join(', ') : null;
}

/** What follows the key on its line, as written, and the items of a list under it. */
function writtenValue(yaml: readonly string[]): string {
    const [first = '', ...rest] = yaml;
    const onLine = first.match(/^(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^:]*):\s*(.*)$/)?.[1] ?? first;
    if (rest.length === 0) return onLine;
    const items = rest.map(line => line.trim().replace(/^- /, ''));
    return onLine === '' ? items.join(', ') : [onLine, ...items].join(' ');
}
