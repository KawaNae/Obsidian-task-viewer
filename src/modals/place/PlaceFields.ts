import { t } from '../../i18n';
import { logWarn } from '../../log/log';
import type { DestinationAsk, NotePlace, NoteRead, PlaceAnswer } from '../../services/data/NotePlaces';
import type { FormIssue } from '../form/FormIssue';
import { LastAnswer } from '../form/LastAnswer';
import { DestinationText } from '../noteops/DestinationText';

/**
 * The place fields of a hub on a task not written yet: a note and where in
 * it (a heading's section, or the note's end) the task is made. This is
 * their logic, apart from the DOM: what they name, told to the hub's host,
 * and what is said under them. What they look like is the place tab's pane
 * (`PlacePane`).
 *
 * - What the destination is, is asked of the vault whenever a field
 *   changes, and as they open (`PlaceFieldsHost.read`, the fields read as
 *   the send dialog's are: `NotePlaces.readFields`), and at no other time.
 *   The host is told the fields are being read at once, before the answer
 *   (`reading`), so a create asked meanwhile waits for it; and then the
 *   answer to what they hold now (`answered`): the note and where in it,
 *   why they name no note, or that it could not be read (a read that
 *   fails or throws). Each `reading` is followed by one answer to what the
 *   fields hold then, unless a later `reading` came first: an asking a
 *   later one came after hands on nothing, its read answered or failed,
 *   and the later one answers. The host waits on this.
 * - The note and the heading go as they are named, a heading by the name
 *   more than once too: whether the task has one place there is the host's
 *   to find, as it reads the place.
 * - Under the fields, only what is wrong or to be warned of is said: a name
 *   no note can have, more than one note by the name, more than one heading
 *   by the name; a note made, the folder made with it, notes by its name in
 *   other folders, a note the views do not show. Which note and where in it
 *   the task goes is said by the line above the create, which is in sight
 *   from either tab; the empty note field is asked for there too.
 * - An Enter in a field does nothing: what the fields name is told as it is
 *   typed.
 */

/** What the fields' issues are said of: the note field, or the heading field. */
export type PlaceField = 'note' | 'heading';

/** What the surface shows. */
export interface PlaceViewState {
    /** The headings of the note the fields name, for the heading field to offer. */
    headings: readonly string[];
    issues: readonly FormIssue<PlaceField>[];
}

export interface PlaceSurface {
    render(state: PlaceViewState): void;
}

export interface PlaceFieldsHost {
    /** What the destination the fields name is (`NotePlaces.readFields`). */
    read(ask: DestinationAsk): Promise<NoteRead>;
    /** The fields changed, or opened: their answer is to come, without fail. */
    reading(): void;
    /** The answer to what the fields hold now, `unread` where it could not be read; only the answer to the last asking. */
    answered(answer: PlaceAnswer): void;
}

export class PlaceFields {
    private ask: DestinationAsk;
    /** What the destination is, as last answered, null where it could not be read: an answer is taken only to the last asking. */
    private readonly answer = new LastAnswer<NoteRead | null>();
    private disposed = false;

    constructor(
        initial: DestinationAsk,
        private readonly host: PlaceFieldsHost,
        private readonly surface: PlaceSurface,
    ) {
        this.ask = { ...initial };
        this.lookUp();
    }

    /** The fields changed: the host is told so, and the destination is asked again. */
    fieldsChanged(ask: DestinationAsk): void {
        this.ask = { ...ask };
        this.lookUp();
    }

    state(): PlaceViewState {
        const read = this.answer.value;
        if (!read) return { headings: [], issues: [] };
        if (read.kind === 'unnamed') {
            return { headings: [], issues: read.why.why === 'empty' ? [] : [{ at: 'note', tone: 'error', text: DestinationText.unnamed(read) }] };
        }
        if (read.kind === 'ambiguous') {
            return { headings: [], issues: [{ at: 'note', tone: 'error', text: DestinationText.ambiguous(read) }] };
        }
        return { headings: read.headings, issues: [...noteIssues(read), ...headingIssues(read)] };
    }

    dispose(): void {
        this.disposed = true;
    }

    /** Tell the host the fields are being read, and ask what they name; the answer is taken only if no asking came after. */
    private lookUp(): void {
        if (this.disposed) return;
        this.host.reading();
        void this.take({ ...this.ask });
    }

    private async take(ask: DestinationAsk): Promise<void> {
        if (!(await this.answer.ask(() => this.read(ask)))) return;
        if (this.disposed) return;
        this.surface.render(this.state());
        this.host.answered(answerOf(this.answer.value));
    }

    /** What the destination `ask` names is; null where the read fails or throws. */
    private async read(ask: DestinationAsk): Promise<NoteRead | null> {
        try {
            return await this.host.read(ask);
        } catch (e) {
            logWarn(`[PlaceFields] the destination could not be read: ${String(e)}`);
            return null;
        }
    }
}

/** What the host is told of `read`: the note and where in it, why the fields name no note, or that it could not be read. */
function answerOf(read: NoteRead | null): PlaceAnswer {
    if (read === null) return { kind: 'unread' };
    return read.kind === 'unnamed' || read.kind === 'ambiguous' ? read : { kind: 'to', to: read.to };
}

/**
 * What is said under the note field of the note `place` names: a note made
 * (by its name or at a path typed, the path left to the line above the
 * create), the folder made with it and its namesakes, and a note the views
 * do not show, all warnings; nothing of a note there is.
 */
function noteIssues(place: NotePlace): FormIssue<PlaceField>[] {
    const warn = (text: string): FormIssue<PlaceField> => ({ at: 'note', tone: 'warning', text });
    const out: FormIssue<PlaceField>[] = [];
    if (place.kind === 'new') {
        out.push(warn(t('modal.newTask.noteNew')));
        if (place.folderMade !== null) out.push(warn(t('modal.destination.noteFolderMade', { folder: place.folderMade })));
        const namesakes = DestinationText.namesakes(place);
        if (namesakes !== null) out.push(warn(namesakes));
    }
    if (place.ignored) out.push(warn(t('modal.newTask.ignored', { note: place.path })));
    return out;
}

/** What is said under the heading field: why there is no one place, of more than one heading by the name; nothing otherwise. */
function headingIssues(place: NotePlace): FormIssue<PlaceField>[] {
    const spot = place.to.spot;
    if (spot === 'end' || place.heading?.kind !== 'many') return [];
    const text = t('modal.newTask.headings', { note: place.path, heading: spot.heading, count: String(place.heading.count) });
    return [{ at: 'heading', tone: 'error', text }];
}
