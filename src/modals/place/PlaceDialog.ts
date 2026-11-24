import { t } from '../../i18n';
import { logWarn } from '../../log/log';
import type { DestinationAsk, NoteDestination, NotePlace, NoteRead } from '../../services/data/NotePlaces';
import type { FormIssue } from '../form/FormIssue';
import { LastAnswer } from '../form/LastAnswer';
import { DestinationText } from '../noteops/DestinationText';

/**
 * The place dialog: a note and where in it (a heading's section, or the
 * note's end) chosen for a task to make there. This is its logic, apart
 * from the DOM: what it says of the destination the fields name, and
 * whether, and where, it may place the task. What it looks like is the
 * surface's (`PlaceModal`).
 *
 * - What the destination is, is asked of the vault whenever a field
 *   changes (`PlaceHost.read`, the fields read as the send dialog's are:
 *   `NotePlaces.readFields`), and only the answer to the last asking is
 *   taken: nothing is placed until the answer is for what the fields hold
 *   now.
 * - A place is chosen only where the fields name one note and one place in
 *   it: not while the note field is empty, names a note no name can have,
 *   or more than one note, nor while the note has more than one heading by
 *   the name. A note not made yet, a heading not made yet, and a note the
 *   views do not show (said so) can be chosen.
 * - The empty note field is not said wrong as the dialog opens on it: only
 *   an Enter in a field says so, until a field changes, and only once the
 *   answer is for what the fields hold now. An answer to what they held
 *   before is not said wrong of a field typed in since; an Enter on the
 *   empty field before its answer is in is said once the answer is.
 * - Under the note field the dialog says which note the task goes to (the
 *   note there is; the note made, and its folder) and what keeps it from
 *   naming one; under the heading, where in the note the task goes, or why
 *   there is no one place.
 * - Nothing is lost to a close: the dialog never asks before one.
 */

/** What the dialog's issues are said of: the note field, or the heading field. */
export type PlaceField = 'note' | 'heading';

/** What the surface shows. */
export interface PlaceViewState {
    /** The headings of the note the fields name, for the heading field to offer. */
    headings: readonly string[];
    issues: readonly FormIssue<PlaceField>[];
    canPlace: boolean;
}

export interface PlaceSurface {
    render(state: PlaceViewState): void;
}

export interface PlaceHost {
    /** What the destination the fields name is (`NotePlaces.readFields`). */
    read(ask: DestinationAsk): Promise<NoteRead>;
    /** The place chosen: the dialog's answer. Whoever hosts it closes it. */
    placed(to: NoteDestination): void;
}

export class PlaceDialog {
    private ask: DestinationAsk;
    /** What the destination is, as last answered: an answer is taken only to the last asking. */
    private readonly answer = new LastAnswer<NoteRead>();
    /** An Enter was pressed on the fields as they stand: an empty note field is said wrong, once the answer is for them. */
    private entered = false;
    private disposed = false;

    constructor(
        initial: DestinationAsk,
        private readonly host: PlaceHost,
        private readonly surface: PlaceSurface,
    ) {
        this.ask = { ...initial };
        void this.lookUp();
    }

    /** The fields changed: the destination is asked again. */
    fieldsChanged(ask: DestinationAsk): void {
        this.ask = { ...ask };
        this.entered = false;
        void this.lookUp();
    }

    state(): PlaceViewState {
        const read = this.answer.value;
        const issues: FormIssue<PlaceField>[] = [];
        if (read?.kind === 'unnamed') {
            if (read.why.why !== 'empty' || (this.entered && this.answer.caughtUp)) issues.push({ at: 'note', tone: 'error', text: DestinationText.unnamed(read) });
        } else if (read?.kind === 'ambiguous') {
            issues.push({ at: 'note', tone: 'error', text: DestinationText.ambiguous(read) });
        } else if (read) {
            issues.push(...noteIssues(read), headingIssue(read));
        }
        return {
            headings: read && read.kind !== 'unnamed' && read.kind !== 'ambiguous' ? read.headings : [],
            issues,
            canPlace: this.place() !== null,
        };
    }

    /** Place the task where the fields name: the button. Nothing while no one place is named. */
    choose(): void {
        const to = this.place();
        if (to) this.host.placed(to);
    }

    /** An Enter in a field: place the task where it can be; an empty note field is said wrong. */
    enter(): void {
        this.entered = true;
        if (this.place()) this.choose();
        else this.render();
    }

    dispose(): void {
        this.disposed = true;
    }

    /** Where the fields name, as last answered; null while that is no one place, or the answer is not for what they hold now. */
    private place(): NoteDestination | null {
        const read = this.answer.value;
        if (!this.answer.caughtUp || !read || read.kind === 'unnamed' || read.kind === 'ambiguous') return null;
        if (read.heading?.kind === 'many') return null;
        return read.to;
    }

    /** Ask what the destination the fields name is; the answer is taken only if no asking came after. */
    private async lookUp(): Promise<void> {
        const ask = { ...this.ask };
        const taking = this.answer.ask(() => this.host.read(ask));
        this.render();
        try {
            if (!(await taking)) return;
        } catch (e) {
            logWarn(`[PlaceDialog] the destination could not be read: ${String(e)}`);
            return;
        }
        this.render();
    }

    private render(): void {
        if (this.disposed) return;
        this.surface.render(this.state());
    }
}

/**
 * What is said under the note field of the note `place` names: the note
 * there is, as any text is, since placing a task there only adds to it;
 * the note made, its folder and its namesakes, as warnings
 * (`DestinationText`); and a note the views do not show.
 */
function noteIssues(place: NotePlace): FormIssue<PlaceField>[] {
    const out: FormIssue<PlaceField>[] = place.kind === 'existing'
        ? [{ at: 'note', tone: 'info', text: DestinationText.existing(place.path) }]
        : DestinationText.made(place).map(says => ({ at: 'note' as const, ...says }));
    const namesakes = place.kind === 'new' ? DestinationText.namesakes(place) : null;
    if (namesakes !== null) out.push({ at: 'note', tone: 'warning', text: namesakes });
    if (place.ignored) out.push({ at: 'note', tone: 'warning', text: t('modal.place.ignored', { note: place.path }) });
    return out;
}

/**
 * Where in the note `place` names the task goes, said under the heading
 * field: at the note's end, under no heading; at the top or the end of the
 * heading's section, by the settings' side; under the heading made; or, of
 * more than one heading by the name, why there is no one place.
 */
function headingIssue(place: NotePlace): FormIssue<PlaceField> {
    const info = (text: string): FormIssue<PlaceField> => ({ at: 'heading', tone: 'info', text });
    const spot = place.to.spot;
    if (spot === 'end') return info(t(place.kind === 'new' ? 'modal.place.toNewEnd' : 'modal.place.toNoteEnd'));
    const vars = { heading: spot.heading };
    const found = place.heading;
    if (place.kind === 'new') return info(t('modal.place.toNew', vars));
    if (found?.kind === 'many') {
        return { at: 'heading', tone: 'error', text: t('modal.place.headings', { ...vars, note: place.path, count: String(found.count) }) };
    }
    if (found === null || found.kind === 'none') return info(t('modal.place.toMade', vars));
    return info(t(spot.side === 'end' ? 'modal.place.toEnd' : 'modal.place.toHead', vars));
}
