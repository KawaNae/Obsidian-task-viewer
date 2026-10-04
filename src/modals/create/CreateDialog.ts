import { t } from '../../i18n';
import { logWarn } from '../../log/log';
import type { CreatePlace, Inherits, PlaceFacts } from '../../services/data/CreatePlaces';
import type { IndexRefusal } from '../../services/core/RefusalClause';
import { formatTaskLine } from '../../services/parsing/TaskLineFormat';
import { refusalText, type WriteAnswer } from '../../services/operations/WriteAnswer';
import type { ValidationContext } from '../TaskDateValidator';
import type { FormIssue, Tone } from '../form/FormIssue';

/**
 * The create dialog (I#3): a new task line, and the place it goes
 * (`CreatePlace`). This is its logic, apart from the DOM: what the place is
 * and what a line there inherits, what the dialog says of it, whether a
 * create may be asked, and the write. What it looks like, and the reading of
 * its fields, is the surface's (`CreateModal`), as the send dialog's is
 * (`SendDialog`, `SendModal`).
 *
 * - What the place is, is asked of the vault once as the dialog opens
 *   (`CreateHost.facts`), and again after a write refused (the note may have
 *   changed under it). A create is not offered until it has answered.
 * - What the fields imply is what a line written there inherits, and only
 *   that (`PlaceFacts.inherits`, the reading's answer): the placeholders
 *   show it, and a time with no date reads as having one only where a date
 *   is inherited. A daily note's day is no such value: the reading gives a
 *   line no date of the note's name, so a time typed with no date is no
 *   start there (the decision of 2026-10-04, 論点1).
 * - A create waits for the write (I#9): written, the dialog closes; not, it
 *   stays as it was, and says why above its buttons once, with no notice.
 *   A refusal that comes after the dialog was closed is told by a notice.
 */

/** What the dialog asks for: the fields of a new task line, read. Its status is unchecked, its marker `- `. */
export interface CreateEntry {
    content: string;
    startDate?: string;   // YYYY-MM-DD
    startTime?: string;   // HH:mm
    endDate?: string;     // YYYY-MM-DD
    endTime?: string;     // HH:mm
    due?: string;         // YYYY-MM-DD or YYYY-MM-DDTHH:mm
}

/** Where the dialog is: open to a create, or creating. */
export type CreatePhase = 'open' | 'creating';

/** What the surface shows. */
export interface CreateViewState {
    phase: CreatePhase;
    /** What a line in the place inherits there; none until the place has answered. */
    inherits: Inherits;
    /** Where the line goes, why it cannot go there, and why the last create was not written: of the form. */
    issues: readonly FormIssue<never>[];
    canCreate: boolean;
}

export interface CreateSurface {
    render(state: CreateViewState): void;
}

export interface CreateHost {
    /** What `place` is (`CreatePlaces.facts`). */
    facts(place: CreatePlace): Promise<PlaceFacts>;
    /** Write `line` in `place` (`CreatePlaces.create`), a refusal answered rather than told. */
    create(place: CreatePlace, line: string): Promise<WriteAnswer>;
    /** A refusal that came once the dialog was closed: told by a notice. */
    tellLate(refused: IndexRefusal): void;
    /** Close the dialog. */
    close(): void;
}

export class CreateDialog {
    private phase: CreatePhase = 'open';
    private facts: PlaceFacts | null = null;
    /** How many times the place was asked: an answer is taken only to the last. */
    private asked = 0;
    private message: string | null = null;
    private disposed = false;

    constructor(
        private readonly place: CreatePlace,
        private readonly host: CreateHost,
        private readonly surface: CreateSurface,
    ) {
        void this.lookUp();
    }

    state(): CreateViewState {
        const facts = this.facts;
        const said = facts ? placeText(facts) : null;
        const issues: FormIssue<never>[] = said ? [{ at: 'form', ...said }] : [];
        if (facts?.kind === 'dailyNote' && facts.ignored) {
            issues.push({ at: 'form', tone: 'warning', text: t('modal.newTask.ignored', { note: facts.path }) });
        }
        if (this.message !== null) issues.push({ at: 'form', tone: 'error', text: this.message });
        const blocked = said?.tone === 'error';
        return {
            phase: this.phase,
            inherits: facts?.inherits ?? {},
            issues,
            canCreate: this.phase === 'open' && facts !== null && !blocked,
        };
    }

    /** The context the date fields' rules are read in: a start date the place gives a line, when it gives one. */
    dateContext(): ValidationContext {
        const start = this.facts?.inherits.startDate;
        return { hasImplicitStartDate: !!start, implicitStartDate: start };
    }

    /**
     * Write `entry` in the place, as an unchecked task line, and close once
     * it is written; a write refused is said above the buttons, and the
     * place asked again. Nothing while a create may not be asked.
     */
    async create(entry: CreateEntry): Promise<void> {
        if (!this.state().canCreate) return;
        this.phase = 'creating';
        this.message = null;
        this.render();

        const answer = await this.host.create(this.place, formatTaskLine({ statusChar: ' ', ...entry }));
        if (this.disposed) {
            if (!answer.written && answer.refused) this.host.tellLate(answer.refused);
            return;
        }
        this.phase = 'open';
        if (answer.written) return this.host.close();
        this.message = refusalText(answer.refused);
        // The note may have changed under the write: its headings, its sections.
        void this.lookUp();
    }

    dispose(): void {
        this.disposed = true;
    }

    /** Ask what the place is; the answer is taken only if no asking came after. */
    private async lookUp(): Promise<void> {
        const seq = ++this.asked;
        this.render();
        let facts: PlaceFacts;
        try {
            facts = await this.host.facts(this.place);
        } catch (e) {
            logWarn(`[CreateDialog] the place could not be read: ${String(e)}`);
            return;
        }
        if (this.disposed || seq !== this.asked) return;
        this.facts = facts;
        this.render();
    }

    private render(): void {
        if (this.disposed) return;
        this.surface.render(this.state());
    }
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
