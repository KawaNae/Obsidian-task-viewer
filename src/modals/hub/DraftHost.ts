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
 * nothing is written until a create is asked (`HubDraft.create`), which puts
 * the task's line and its property lines in with one write.
 *
 * - What the place is, and what a line there inherits, is asked of the vault
 *   once the hub has opened, and again after a write refused (the note may
 *   have changed under it); only the answer to the last asking is taken. Each
 *   answer puts the draft in the place anew (`withPlace`): what it inherits
 *   changes, what it was given stays. A create is not offered until the
 *   place has answered, nor where the task cannot go.
 * - The place fields tell each time they are typed in (`reading`) and each
 *   answer to what they hold now (`answered`). An answer naming a note is
 *   the place `fromDestination` makes of it by the place the hub opened on,
 *   so an answer in that note is that note still, a daily note made of its
 *   day's template; it is read anew unless it is the place the draft is in
 *   already. An answer naming no note leaves the draft in no place, says
 *   why above the create, and offers no create. Moving takes back why a
 *   create was refused: that was of the place left.
 * - While the fields or the place are being read, the create looks as it
 *   did, so it does not flicker at each key typed; a create asked then
 *   waits for the answer, and is asked of the form again once it comes
 *   (`HubForm.create`), so the dates are seen under what the place
 *   gives now. An answer naming no note drops it.
 * - A create waits for the write: written, the hub closes; refused, why is
 *   said above the create once, with no notice, and the place is asked
 *   again. The fields are shut meanwhile: what was typed after the write was
 *   made would not be written, and would be lost as the hub closes. A close
 *   asked for meanwhile waits for the write. A refusal that comes after the
 *   hub closed otherwise is told by a notice.
 * - Whether anything was given is whether a write now would write other
 *   than the task as it opened (`newRowOf`), or the place is another than
 *   it opened on (`samePlace`): a value given and taken back again is nothing.
 * - There is no row whose lines could be opened (`openSource` null).
 */
export class DraftHost implements PanelHost, HubDraft {
    private value: Task;
    /** The task as it opened: what {@link changed} compares with. */
    private readonly opened: Task;
    /** The place now; null while the place fields name no note. */
    private place: CreatePlace | null;
    /** The place the hub opened on: what an answer is taken by (`fromDestination`), and what {@link changed} compares with. */
    private readonly openedOn: CreatePlace | null;
    private at: DraftAt;
    private facts: PlaceFacts | null = null;
    /** The place `facts` were read of. */
    private factsOf: CreatePlace | null = null;
    /** How many times the place was asked: an answer is taken only to the last. */
    private asked = 0;
    /** The asking last done with, answered or failed: one after it is still under way. */
    private settled = 0;
    /** The place fields were typed in, and their answer is yet to come. */
    private fieldsReading = false;
    /** A create was asked while the fields or the place were being read: it is asked again once they answer. */
    private createWhenRead = false;
    /** The create's write while it is under way. */
    private making: Promise<WriteAnswer> | null = null;
    private form: HubForm | null = null;
    private panel: HubPanel | null = null;
    /** Whether what was handed on is yet to be drawn in the card and the fields. */
    private drawing = false;
    /** The hub closed: a refusal that comes after is told by a notice. */
    private closed = false;

    readonly openSource = null;
    readonly draft: HubDraft = this;

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
        return this.place !== null && this.facts !== null && !placeIssues(this.facts).some(issue => issue.tone === 'error')
            && this.making === null && !this.closed;
    }

    /** Whether the place fields or the place are being read: a create asked now waits for them. */
    private waiting(): boolean {
        return this.fieldsReading || this.settled < this.asked;
    }

    creating(): boolean {
        return this.making !== null;
    }

    changed(): boolean {
        return !same(this.place, this.openedOn)
            || !sameRow(newRowOf(this.value, this.deps.scopeKeys()), newRowOf(this.opened, this.deps.scopeKeys()));
    }

    /**
     * Write the draft in the place, as its row (`newRowOf`); nothing while a
     * create may not be asked. Asked while the fields or the place are being
     * read, it waits for them.
     */
    create(): void {
        if (!this.canCreate() || !this.place) return;
        if (this.waiting()) {
            this.createWhenRead = true;
            return;
        }
        this.createWhenRead = false;
        const row = newRowOf(this.value, this.deps.scopeKeys());
        const making = this.deps.places.create(this.place, row, { tellRefusal: false })
            .catch((e: unknown) => {
                logError(`[DraftHost] create failed: ${e instanceof Error ? e.message : String(e)}`);
                return notWritten();
            });
        this.making = making;
        this.form?.sayWrite(null);
        this.form?.showShut();
        this.form?.showDraft();
        void making.then(answer => this.made(answer));
    }

    /** The create's answer: written, the hub closes; refused, why is said, the fields open again, and the place is asked again. */
    private made(answer: WriteAnswer): void {
        this.making = null;
        if (this.closed) {
            if (!answer.written && answer.refused) new Notice(refusalNotice(answer.refused));
            return;
        }
        if (answer.written) {
            this.panel?.close();
            return;
        }
        this.form?.sayWrite(refusalText(answer.refused));
        this.form?.showShut();
        this.form?.showDraft();
        // The note may have changed under the write: its headings, its sections.
        void this.lookUp();
    }

    /** A create under way is waited for: written, the hub closes; refused, it stays open with why above the create. */
    closing(): CloseAnswer {
        if (!this.making) return 'close';
        return this.making.then(answer => (answer.written ? 'close' : 'stay'));
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

    /** The place fields were typed in: their answer is waited for. Nothing is taken while a create is under way. */
    reading(): void {
        if (this.making || this.closed) return;
        this.fieldsReading = true;
    }

    /**
     * The place fields' answer to what they hold now: the draft moves to the
     * place it names, read anew unless it is there already, or to no place.
     * Nothing is taken while a create is under way (the fields are shut,
     * and only an answer asked before it can come), nor once the hub closed.
     */
    answered(answer: PlaceAnswer): void {
        if (this.making || this.closed) return;
        this.fieldsReading = false;
        if (answer.kind !== 'to') {
            this.moveToNone(answer);
            return;
        }
        const next = this.deps.places.fromDestination(answer.to, this.openedOn ?? undefined);
        if (this.place && samePlace(next, this.place) && (this.facts !== null || this.waiting())) {
            this.form?.showDraft();
            this.createIfAsked();
            return;
        }
        this.place = next;
        this.form?.sayWrite(null);
        void this.lookUp();
    }

    /** The place fields name no note: the draft is in no place, why is said, and no create is offered nor waits. */
    private moveToNone(answer: Extract<PlaceAnswer, { kind: 'unnamed' | 'ambiguous' }>): void {
        this.place = null;
        this.form?.sayWrite(null);
        // No asking still under way is taken: it is of the place left.
        this.settled = ++this.asked;
        this.facts = null;
        this.factsOf = null;
        this.createWhenRead = false;
        this.at = { file: '', inherits: {} };
        this.value = withPlace(this.value, this.at);
        this.form?.sayPlace(noPlaceIssues(answer));
        this.form?.refresh();
        this.form?.showDraft();
        this.panel?.redrawPreview();
    }

    /** A create asked while reading, asked of the form again once nothing is being read. */
    private createIfAsked(): void {
        if (!this.createWhenRead || this.waiting()) return;
        this.createWhenRead = false;
        this.form?.create();
    }

    /** The hub closed: no answer is taken any more, and a refusal that comes after is told by a notice. */
    dispose(): void {
        this.closed = true;
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
            // What was read of another place says nothing of this one: no create is offered here.
            this.settled = seq;
            this.createWhenRead = false;
            if (!same(this.factsOf, place)) this.facts = null;
            this.form?.showDraft();
            return;
        }
        if (this.closed || seq !== this.asked) return;
        this.settled = seq;
        this.facts = facts;
        this.factsOf = place;
        const { inherits, inheritedFrom } = facts;
        this.at = { file: this.deps.places.noteOf(place) ?? this.at.file, inherits, ...(inheritedFrom && { inheritedFrom }) };
        this.value = withPlace(this.value, this.at);
        this.form?.sayPlace(placeIssues(facts));
        this.form?.refresh();
        this.form?.showDraft();
        this.panel?.redrawPreview();
        this.createIfAsked();
    }
}

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
export function noPlaceIssues(read: Extract<NoteRead, { kind: 'unnamed' | 'ambiguous' }>): FormIssue<never>[] {
    if (read.kind === 'unnamed' && read.why.why === 'empty') return [{ at: 'form', tone: 'info', text: t('modal.newTask.noNote') }];
    const text = read.kind === 'unnamed' ? DestinationText.unnamed(read) : DestinationText.ambiguous(read);
    return [{ at: 'form', tone: 'error', text }];
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
 * name mistyped in the place's fields is seen from the properties' tab too;
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
