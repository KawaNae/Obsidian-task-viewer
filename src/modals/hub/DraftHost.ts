import { Notice } from 'obsidian';
import { t } from '../../i18n';
import type { ScopeKeys, Task } from '../../types';
import type { CreatePlace, CreatePlaces, PlaceFacts } from '../../services/data/CreatePlaces';
import { applyToDraft, draftTask, newRowOf, withPlace, type DraftAt, type DraftSeed } from '../../services/data/TaskDraft';
import type { NewRow } from '../../services/persistence/NewRow';
import { refusalNotice } from '../../services/core/RefusalClause';
import { notWritten, refusalText, type WriteAnswer } from '../../services/operations/WriteAnswer';
import { logError, logWarn } from '../../log/log';
import type { CloseAnswer } from '../../views/sharedUI/CloseGate';
import type { FormIssue, Tone } from '../form/FormIssue';
import type { HubDraft, HubForm, HubPanel, PanelHost } from './HubHost';

export interface DraftHostDeps {
    /** What the place is, the note a line there is in, and the write there. */
    places: Pick<CreatePlaces, 'facts' | 'noteOf' | 'create'>;
    /** The keys the row's property lines are written with, read as a write is made. */
    scopeKeys: () => ScopeKeys;
}

/**
 * The host of a hub on a task not written yet, to be put in `place`: what
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
 * - A create waits for the write: written, the hub closes; refused, why is
 *   said at the form's end once, with no notice, and the place is asked
 *   again. The fields are shut meanwhile: what was typed after the write was
 *   made would not be written, and would be lost as the hub closes. A close
 *   asked for meanwhile waits for the write. A refusal that comes after the
 *   hub closed otherwise is told by a notice.
 * - Whether anything was given is whether a write now would write other
 *   than the task as it opened (`newRowOf`): a value given and taken back
 *   again is nothing.
 * - There is no row whose lines could be opened (`openSource` null).
 */
export class DraftHost implements PanelHost, HubDraft {
    private value: Task;
    /** The task as it opened: what {@link changed} compares with. */
    private readonly opened: Task;
    private at: DraftAt;
    private facts: PlaceFacts | null = null;
    /** How many times the place was asked: an answer is taken only to the last. */
    private asked = 0;
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

    constructor(private readonly place: CreatePlace, seed: DraftSeed, private readonly deps: DraftHostDeps) {
        this.at = { file: deps.places.noteOf(place) ?? '', inherits: {} };
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

    canCreate(): boolean {
        return this.facts !== null && !placeIssues(this.facts).some(issue => issue.tone === 'error')
            && this.making === null && !this.closed;
    }

    creating(): boolean {
        return this.making !== null;
    }

    changed(): boolean {
        return !sameRow(newRowOf(this.value, this.deps.scopeKeys()), newRowOf(this.opened, this.deps.scopeKeys()));
    }

    /** Write the draft in the place, as its row (`newRowOf`); nothing while a create may not be asked. */
    create(): void {
        if (!this.canCreate()) return;
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

    /** A create under way is waited for: written, the hub closes; refused, it stays open with why at the form's end. */
    closing(): CloseAnswer {
        if (!this.making) return 'close';
        return this.making.then(answer => (answer.written ? 'close' : 'stay'));
    }

    bind(form: HubForm): void {
        this.form = form;
    }

    /** The hub has opened: the place is asked what it is. */
    attach(panel: HubPanel): void {
        this.panel = panel;
        void this.lookUp();
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
        const seq = ++this.asked;
        let facts: PlaceFacts;
        try {
            facts = await this.deps.places.facts(this.place);
        } catch (e) {
            logWarn(`[DraftHost] the place could not be read: ${String(e)}`);
            return;
        }
        if (this.closed || seq !== this.asked) return;
        this.facts = facts;
        const { inherits, inheritedFrom } = facts;
        this.at = { file: this.deps.places.noteOf(this.place) ?? this.at.file, inherits, ...(inheritedFrom && { inheritedFrom }) };
        this.value = withPlace(this.value, this.at);
        this.form?.sayPlace(placeIssues(facts));
        this.form?.refresh();
        this.form?.showDraft();
        this.panel?.redrawPreview();
    }
}

/** Whether two rows write the same: the line, and the property lines' ops. */
function sameRow(a: NewRow, b: NewRow): boolean {
    return a.line === b.line && JSON.stringify(a.properties?.ops ?? []) === JSON.stringify(b.properties?.ops ?? []);
}

/**
 * What a form making a task line in a place says of the place `facts`
 * names: where the line goes (an error when it cannot go there), and a
 * warning when the note is one the views do not read.
 */
export function placeIssues(facts: PlaceFacts): FormIssue<never>[] {
    const issues: FormIssue<never>[] = [{ at: 'form', ...placeText(facts) }];
    if (facts.kind === 'dailyNote' && facts.ignored) {
        issues.push({ at: 'form', tone: 'warning', text: t('modal.newTask.ignored', { note: facts.path }) });
    }
    return issues;
}

/**
 * Where a line put in the place `facts` names goes, in one sentence: an info,
 * or an error when it cannot go there (the heading names no one section, the
 * row is gone).
 */
export function placeText(facts: PlaceFacts): { text: string; tone: Tone } {
    switch (facts.kind) {
        case 'gone':
            return { text: t('modal.newTask.gone'), tone: 'error' };
        case 'childOf':
            return { text: t('modal.newTask.toChild', { parent: facts.parent }), tone: 'info' };
        case 'dailyNote': {
            const vars = { note: facts.path, heading: facts.section.heading };
            if (facts.heading.kind === 'many') {
                return { text: t('modal.newTask.headings', { ...vars, count: String(facts.heading.count) }), tone: 'error' };
            }
            if (facts.note === 'new') return { text: t('modal.newTask.toNew', vars), tone: 'info' };
            if (facts.heading.kind === 'none') return { text: t('modal.newTask.toMade', vars), tone: 'info' };
            return { text: t(facts.section.side === 'end' ? 'modal.newTask.toEnd' : 'modal.newTask.toHead', vars), tone: 'info' };
        }
    }
}
