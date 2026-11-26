import { Notice } from 'obsidian';
import { t } from '../../i18n';
import type { ScopeKeys, Task } from '../../types';
import { samePlace, type CreatePlace, type CreatePlaces, type PlaceFacts } from '../../services/data/CreatePlaces';
import type { NoteRead, PlaceAnswer } from '../../services/data/NotePlaces';
import { applyToDraft, draftTask, newRowOf, withPlace, type DraftAt, type DraftSeed } from '../../services/data/TaskDraft';
import type { NewRow } from '../../services/persistence/NewRow';
import { refusalNotice } from '../../services/core/RefusalClause';
import { notWritten, refusalText, type WriteAnswer } from '../../services/operations/WriteAnswer';
import { logError, logWarn } from '../../log/log';
import type { CloseAnswer } from '../../views/sharedUI/CloseGate';
import type { FormIssue, Tone } from '../form/FormIssue';
import { DestinationText } from '../noteops/DestinationText';
import type { ShownPlace } from '../place/PlaceShown';
import type { HubDraft, HubForm, HubPanel, PanelHost } from './HubHost';

export interface DraftHostDeps {
    /** What the place is, the note a line there is in, the write there, and the place the place fields' answer names. */
    places: Pick<CreatePlaces, 'facts' | 'noteOf' | 'create' | 'fromDestination'>;
    /** The keys the row's property lines are written with, read as a write is made. */
    scopeKeys: () => ScopeKeys;
}

/**
 * The host of a hub on a task not written yet, to be put in `place`, or in
 * a place the user chooses in its place fields when it opens on none: what
 * the fields hand on is put over the draft at once (`applyToDraft`), and
 * nothing is written until a create is asked (`create`), which puts
 * the task's line and its property lines in with one write.
 *
 * - What the place is, and what a line there inherits, is asked of the vault
 *   once the hub has opened, and again after a write refused (the note may
 *   have changed under it); only the answer to the last asking is taken. Each
 *   answer puts the draft in the place anew (`withPlace`): what it inherits
 *   changes, what it was given stays. A create is not offered until the
 *   place has answered, nor where the task cannot go.
 * - The place fields tell each time they are typed in (`reading`) and then
 *   the answer to what they hold now (`answered`), which comes without fail.
 *   An answer naming a note is the place `fromDestination` makes of it by
 *   the place the hub opened on, so an answer in that note is that note
 *   still, a daily note made of its day's template; it is read anew unless
 *   it is the place the draft is in already. An answer naming no note, or
 *   saying the fields could not be read, leaves the draft in no place, says
 *   why above the create, and offers no create. Moving takes back why a
 *   create was refused: that was of the place left. A place moved to that
 *   could not be read is said so, and keeps nothing of the place left; the
 *   place asked again after a refusal that could not be read stays as it
 *   was last read.
 * - While the fields or the place are being read, the create looks as it
 *   did, so it does not flicker at each key typed.
 * - A create is under way from its press until it is written or found not
 *   to be: the fields are shut (what was typed after the press would not be
 *   written, and would be lost as the hub closes), the create reads as
 *   creating, and a close asked meanwhile waits for its end. Asked while the
 *   fields or the place are being read, it waits for them; once they have
 *   answered, it is asked of the form again (`HubForm.write`), the fields
 *   open, so the dates are seen under what the place gives now (a field
 *   they break takes the focus, and nothing is written), and it ends
 *   unwritten where the task cannot go or the place could not be read, why
 *   said above the create.
 * - Written, the hub closes; refused, why is said above the create once,
 *   with no notice, and the place is asked again. A refusal that comes after
 *   the hub closed otherwise is told by a notice.
 * - A create ended unwritten is told to the form once (`notWritten`), the
 *   fields open and nothing being read, a refused create's place asked
 *   again first: the form puts the focus by whether a create may be asked
 *   then. Not where the form found a field to fix (it focused it), nor once
 *   the hub closed.
 * - Whether anything was given is whether a write now would write other
 *   than the task as it opened (`newRowOf`), or the place is another than
 *   it opened on (`samePlace`): a value given and taken back again is nothing.
 * - Under a row, where the place cannot be changed, the note, the heading
 *   and the parent the place last read names are shown with no field
 *   (`shown`), drawn again as the form is.
 * - There is no row whose lines could be opened (`openSource` null).
 */
export class DraftHost implements PanelHost {
    private value: Task;
    /** The task as it opened: what {@link changed} compares with. */
    private readonly opened: Task;
    /** The place now; null while the place fields name no note. */
    private place: CreatePlace | null;
    /** The place the hub opened on: what an answer is taken by (`fromDestination`), and what {@link changed} compares with. */
    private readonly openedOn: CreatePlace | null;
    private at: DraftAt;
    /** What the place last read is, with the place it was read of: of the place left while the one moved to is read. */
    private read: { of: CreatePlace; facts: PlaceFacts } | null = null;
    /** How many times the place was asked: an answer is taken only to the last. */
    private asked = 0;
    /** The asking last done with, answered or failed: one after it is still under way. */
    private settled = 0;
    /** The place fields were typed in, and their answer is yet to come. */
    private fieldsReading = false;
    /**
     * The create under way, from its press until it is written or found not
     * to be: told whether it was written as it ends. It waits for the fields
     * and the place while they are read, and writes once they are not.
     */
    private making: Making | null = null;
    /**
     * A create ended unwritten, and the form is yet to be told so
     * (`HubForm.notWritten`): it is told once nothing is being read, so it
     * puts the focus by the place as it is then, a refused create's place
     * asked again first.
     */
    private unwritten = false;
    private form: HubForm | null = null;
    private panel: HubPanel | null = null;
    /** Whether what was handed on is yet to be drawn in the card and the fields. */
    private drawing = false;
    /** The hub closed: a refusal that comes after is told by a notice. */
    private closed = false;

    readonly openSource = null;
    /**
     * The task not written yet, as the form sees it: always held, its write
     * the create. Throwing it away is closing the hub, which is nothing but it.
     */
    private readonly asDraft: HubDraft = {
        label: t('modal.create'),
        busyLabel: t('modal.newTask.creating'),
        canWrite: () => this.canCreate(),
        writing: () => this.creating(),
        write: () => this.create(),
        discard: null,
        changed: () => this.changed(),
    };

    constructor(place: CreatePlace | null, seed: DraftSeed, private readonly deps: DraftHostDeps) {
        this.place = place;
        this.openedOn = place;
        this.at = { file: (place && deps.places.noteOf(place)) ?? '', inherits: {} };
        this.opened = draftTask(this.at, seed);
        this.value = this.opened;
    }

    task(): Task {
        return this.value;
    }

    draft(): HubDraft {
        return this.asDraft;
    }

    /**
     * Put `updates` over the draft, and draw it in the card and the fields
     * once the field handing them on is done, as a row's echo comes after its
     * write. Taken at once; nothing is taken while a create is under way.
     */
    put(updates: Partial<Task> | null): Promise<boolean> {
        if (this.making) return Promise.resolve(false);
        if (!updates) return Promise.resolve(true);
        this.value = applyToDraft(this.value, updates, this.at);
        this.drawSoon();
        return Promise.resolve(true);
    }

    private drawSoon(): void {
        if (this.drawing) return;
        this.drawing = true;
        queueMicrotask(() => {
            this.drawing = false;
            if (this.closed) return;
            this.panel?.redrawPreview();
            this.form?.refresh();
        });
    }

    shut(): string | null {
        return this.making ? t('modal.newTask.formShut') : null;
    }

    /** Whether a create may be asked: while the fields or the place are being read, as the place last read says. */
    canCreate(): boolean {
        return this.place !== null && this.read !== null && !placeIssues(this.read.facts).some(issue => issue.tone === 'error')
            && this.making === null && !this.closed;
    }

    /** Whether the place fields or the place are being read: a create asked now waits for them. */
    private waiting(): boolean {
        return this.fieldsReading || this.settled < this.asked;
    }

    /**
     * Whether a create's write is under way. It is made once nothing is being
     * read, so no asking of the place ends during it; what the fields tell
     * then is not taken.
     */
    private writing(): boolean {
        return this.making?.writing === true;
    }

    creating(): boolean {
        return this.making !== null;
    }

    /** Where the task goes as the place last read says, for a place shown with no field; null until it is read, and for a place it does not say. */
    shown(): ShownPlace | null {
        return this.read && shownOf(this.read.facts);
    }

    changed(): boolean {
        return !same(this.place, this.openedOn)
            || !sameRow(newRowOf(this.value, this.deps.scopeKeys()), newRowOf(this.opened, this.deps.scopeKeys()));
    }

    /**
     * Begin a create, as its row (`newRowOf`) in the place; nothing while a
     * create may not be asked. It is under way from now: written at once,
     * or, while the fields or the place are being read, once they answer.
     */
    create(): void {
        if (!this.canCreate()) return;
        // This create ends as it ends: the one ended before is no longer to be told.
        this.unwritten = false;
        this.making = making();
        this.form?.sayWrite(null);
        this.form?.showShut();
        this.form?.showDraft();
        if (!this.waiting()) this.write(this.making);
    }

    /** Write the draft in the place: what the create under way waited for is read. */
    private write(making: Making): void {
        const place = this.place;
        if (!place) return;
        making.writing = true;
        const row = newRowOf(this.value, this.deps.scopeKeys());
        void this.deps.places.create(place, row, { tellRefusal: false })
            .catch((e: unknown) => {
                logError(`[DraftHost] create failed: ${e instanceof Error ? e.message : String(e)}`);
                return notWritten();
            })
            .then(answer => this.made(answer, making));
    }

    /**
     * The create's answer: written, the hub closes; refused, why is said, the
     * fields open again, and the place is asked again, the form told the
     * create ended once it has answered.
     */
    private made(answer: WriteAnswer, making: Making): void {
        this.making = null;
        making.end(answer.written);
        if (this.closed) {
            if (!answer.written && answer.refused) new Notice(refusalNotice(answer.refused));
            return;
        }
        if (answer.written) {
            this.panel?.close();
            return;
        }
        this.unwritten = true;
        this.form?.sayWrite(refusalText(answer.refused));
        this.form?.showShut();
        this.form?.showDraft();
        // The note may have changed under the write: its headings, its sections.
        void this.lookUp();
    }

    /**
     * Nothing is being read any more. A create that waited for the fields
     * and the place is asked of the form again, the fields open, where the
     * task can go there (the form asks {@link create} once it finds nothing
     * to fix, and this create ends as that one does); it ends unwritten
     * otherwise, why said as the answer said it. Then a create ended
     * unwritten is told to the form, but where the form found a field to
     * fix: it put the focus there itself.
     */
    private readDone(): void {
        if (this.closed || this.waiting()) return;
        const waited = this.making;
        if (waited) {
            this.making = null;
            this.form?.showShut();
            const offered = this.canCreate();
            if (offered) this.form?.write();
            const again = this.making as Making | null;
            if (again) {
                void again.done.then(waited.end);
                return;
            }
            waited.end(false);
            this.form?.showDraft();
            if (offered) return;
            this.unwritten = true;
        }
        if (!this.unwritten) return;
        this.unwritten = false;
        this.form?.notWritten();
    }

    /** End the create waiting for a read unwritten, why said above it: the read failed. */
    private dropWaiting(why: string): void {
        const waited = this.making;
        if (!waited) return;
        this.making = null;
        this.unwritten = true;
        waited.end(false);
        this.form?.sayWrite(why);
        this.form?.showShut();
        this.form?.showDraft();
    }

    /** A create under way is waited for: written, the hub closes; not written, it stays open with why above the create. */
    closing(): CloseAnswer {
        if (!this.making) return 'close';
        return this.making.done.then(written => (written ? 'close' : 'stay'));
    }

    bind(form: HubForm): void {
        this.form = form;
    }

    /** The hub has opened: the place is asked what it is; with none, the user is asked for a note. */
    attach(panel: HubPanel): void {
        this.panel = panel;
        if (this.place) void this.lookUp();
        else this.form?.sayPlace(noPlaceIssues(NO_NOTE));
    }

    /** The place fields were typed in: their answer is waited for. Nothing is taken while a write is under way. */
    reading(): void {
        if (this.writing() || this.closed) return;
        this.fieldsReading = true;
    }

    /**
     * The place fields' answer to what they hold now: the draft moves to the
     * place it names, read anew unless it is there already, or to no place.
     * Nothing is taken while a write is under way (the fields are shut, and
     * no answer is to come), nor once the hub closed.
     */
    answered(answer: PlaceAnswer): void {
        if (this.writing() || this.closed) return;
        this.fieldsReading = false;
        if (answer.kind !== 'to') {
            this.moveToNone(answer);
            this.readDone();
            return;
        }
        const next = this.deps.places.fromDestination(answer.to, this.openedOn ?? undefined);
        if (this.place && samePlace(next, this.place) && (this.read !== null || this.waiting())) {
            this.form?.showDraft();
            this.readDone();
            return;
        }
        this.place = next;
        this.form?.sayWrite(null);
        void this.lookUp();
    }

    /** The place fields name no note, or could not be read: the draft is in no place, why is said, and no create is offered. */
    private moveToNone(answer: Exclude<PlaceAnswer, { kind: 'to' }>): void {
        this.place = null;
        this.form?.sayWrite(null);
        // No asking still under way is taken: it is of the place left.
        this.settled = ++this.asked;
        this.putNowhere(noPlaceIssues(answer));
    }

    /** The draft in no place known: it inherits nothing, its card names no note, and `issues` say why above the create. */
    private putNowhere(issues: readonly FormIssue<never>[]): void {
        this.read = null;
        this.at = { file: '', inherits: {} };
        this.value = withPlace(this.value, this.at);
        this.form?.sayPlace(issues);
        this.form?.refresh();
        this.form?.showDraft();
        this.panel?.redrawPreview();
    }

    /** The hub closed: no answer is taken any more, a create waiting for one ends unwritten (one being written ends with the write's answer), and a refusal that comes after is told by a notice. */
    dispose(): void {
        this.closed = true;
        const waited = this.making;
        if (!waited || waited.writing) return;
        this.making = null;
        waited.end(false);
    }

    /**
     * Ask what the place is; the answer is taken only if no asking came
     * after. Taken, the draft is put in the place as it answers, said where
     * it goes, and drawn again.
     */
    private async lookUp(): Promise<void> {
        const place = this.place;
        if (!place) return;
        const seq = ++this.asked;
        let facts: PlaceFacts;
        try {
            facts = await this.deps.places.facts(place);
        } catch (e) {
            logWarn(`[DraftHost] the place could not be read: ${String(e)}`);
            if (this.closed || seq !== this.asked) return;
            this.settled = seq;
            if (same(this.read?.of ?? null, place)) {
                // Asked again after a refusal: what was read of it stands, but not for a create that waited on this asking.
                this.dropWaiting(t('modal.newTask.unread'));
                this.readDone();
                return;
            }
            // What was read of another place says nothing of this one.
            this.putNowhere(UNREAD_ISSUES);
            this.readDone();
            return;
        }
        if (this.closed || seq !== this.asked) return;
        this.settled = seq;
        this.read = { of: place, facts };
        const { inherits, inheritedFrom } = facts;
        this.at = { file: this.deps.places.noteOf(place) ?? this.at.file, inherits, ...(inheritedFrom && { inheritedFrom }) };
        this.value = withPlace(this.value, this.at);
        this.form?.sayPlace(placeIssues(facts));
        this.form?.refresh();
        this.form?.showDraft();
        this.panel?.redrawPreview();
        this.readDone();
    }
}

/** A create under way: whether it was written, told once as it ends, and whether its write is made (it waits for a read until then). */
interface Making {
    readonly done: Promise<boolean>;
    end(written: boolean): void;
    writing: boolean;
}

function making(): Making {
    let end: (written: boolean) => void = () => { };
    const done = new Promise<boolean>(resolve => { end = resolve; });
    return { done, end, writing: false };
}

/** What is said above the create while what the place fields name, or the place moved to, could not be read. */
const UNREAD_ISSUES: FormIssue<never>[] = [{ at: 'form', tone: 'error', text: t('modal.newTask.unread') }];

/** The note field empty: no note named yet. */
const NO_NOTE: Extract<NoteRead, { kind: 'unnamed' }> = { kind: 'unnamed', why: { ok: false, why: 'empty', at: 'name' } };

/** Whether `a` and `b` are both no place, or the same place. */
function same(a: CreatePlace | null, b: CreatePlace | null): boolean {
    return a === null || b === null ? a === b : samePlace(a, b);
}

/** Whether two rows write the same: the line, and the property lines' ops. */
function sameRow(a: NewRow, b: NewRow): boolean {
    return a.line === b.line && JSON.stringify(a.properties?.ops ?? []) === JSON.stringify(b.properties?.ops ?? []);
}

/**
 * What a form making a task line says while its place fields name no note:
 * the field empty asks for one, as the hub opened to choose it does; a name
 * no note can have and more than one note by the name are errors, said as
 * under the field, so they are seen from another tab too.
 */
export function noPlaceIssues(read: Exclude<PlaceAnswer, { kind: 'to' }>): FormIssue<never>[] {
    if (read.kind === 'unread') return UNREAD_ISSUES;
    if (read.kind === 'unnamed' && read.why.why === 'empty') return [{ at: 'form', tone: 'info', text: t('modal.newTask.noNote') }];
    const text = read.kind === 'unnamed' ? DestinationText.unnamed(read) : DestinationText.ambiguous(read);
    return [{ at: 'form', tone: 'error', text }];
}

/** Where a line put in the place `facts` names goes, as a place shown with no field says it: under a row only. */
export function shownOf(facts: PlaceFacts): ShownPlace | null {
    return facts.kind === 'childOf' ? { note: facts.path, heading: facts.under, parent: facts.parent } : null;
}

/**
 * What a form making a task line in a place says of the place `facts`
 * names: where the line goes (an error when it cannot go there), and a
 * warning when the note is one the views do not read.
 */
export function placeIssues(facts: PlaceFacts): FormIssue<never>[] {
    const issues: FormIssue<never>[] = [{ at: 'form', ...placeText(facts) }];
    if (facts.kind === 'note' && facts.ignored) {
        issues.push({ at: 'form', tone: 'warning', text: t('modal.newTask.ignored', { note: facts.path }) });
    }
    return issues;
}

/**
 * Where a line put in the place `facts` names goes, in one sentence: an info,
 * a warning when a note is made empty for it, or an error when it cannot go
 * there (the heading names no one section, the row is gone).
 */
export function placeText(facts: PlaceFacts): { text: string; tone: Tone } {
    switch (facts.kind) {
        case 'gone':
            return { text: t('modal.newTask.gone'), tone: 'error' };
        case 'childOf':
            return { text: t('modal.newTask.toChild', { parent: facts.parent }), tone: 'info' };
        case 'note':
            return { text: noteText(facts), tone: noteTone(facts) };
    }
}

/**
 * The tone of where a line put in a note goes: an error where the heading
 * names no one section; a warning where a note is made empty for it, so a
 * name mistyped in the place's fields is seen from the details' tab too;
 * an info otherwise, a daily note made of its day's template among them.
 */
function noteTone(facts: Extract<PlaceFacts, { kind: 'note' }>): Tone {
    if (facts.heading?.kind === 'many') return 'error';
    if (facts.note === 'new' && facts.seed === 'empty') return 'warning';
    return 'info';
}

/**
 * Where a line put in a note goes: at the end of the note, or in a section
 * of it — at its head or its end, under a heading made, or nowhere when
 * more than one heading goes by the name. A note made for the line is said
 * so, as a daily note when it is made of the day's template.
 */
function noteText(facts: Extract<PlaceFacts, { kind: 'note' }>): string {
    const made = facts.note === 'new' ? facts.seed : null;
    if (facts.spot === 'end') {
        const note = { note: facts.path };
        if (made === 'daily') return t('modal.newTask.toNewEnd', note);
        if (made === 'empty') return t('modal.newTask.toNewNoteEnd', note);
        return t('modal.newTask.toNoteEnd', note);
    }
    const vars = { note: facts.path, heading: facts.spot.heading };
    if (facts.heading?.kind === 'many') return t('modal.newTask.headings', { ...vars, count: String(facts.heading.count) });
    if (made === 'daily') return t('modal.newTask.toNew', vars);
    if (made === 'empty') return t('modal.newTask.toNewNote', vars);
    if (facts.heading?.kind === 'none') return t('modal.newTask.toMade', vars);
    return t(facts.spot.side === 'end' ? 'modal.newTask.toEnd' : 'modal.newTask.toHead', vars);
}
