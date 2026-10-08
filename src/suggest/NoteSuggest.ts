import type { App } from 'obsidian';
import { renderComplex, noteItem } from './candidateView';
import { NOTE_CANDIDATE_LIMIT, noteCandidatesIn, type NoteCandidate, type NoteCandidateKinds } from './NoteCandidates';
import { ShownSuggest } from './ShownSuggest';

/** What a {@link NoteSuggest} lists, and what picking does. */
export interface NoteSuggestOptions {
    kinds: NoteCandidateKinds;
    /** A candidate was picked: what goes in the field, the caller says. */
    pick(candidate: NoteCandidate): void;
}

/**
 * The vault's notes under a field, matched against the whole field and
 * drawn as Obsidian's `[[` draws them (`NoteCandidates`, `candidateView`):
 * the settings' templates, and the send dialog's note.
 */
export class NoteSuggest extends ShownSuggest<NoteCandidate> {
    constructor(app: App, inputEl: HTMLInputElement, private readonly opts: NoteSuggestOptions) {
        super(app, inputEl);
        this.limit = NOTE_CANDIDATE_LIMIT;
    }

    protected getSuggestions(query: string): NoteCandidate[] {
        return noteCandidatesIn(this.app, this.opts.kinds, query);
    }

    renderSuggestion(candidate: NoteCandidate, el: HTMLElement): void {
        renderComplex(el, noteItem(candidate));
    }

    protected pick(candidate: NoteCandidate): void {
        this.opts.pick(candidate);
        this.close();
    }
}
