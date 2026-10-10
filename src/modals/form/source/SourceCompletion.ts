import { autocompletion, pickedCompletion, type Completion, type CompletionSource } from '@codemirror/autocomplete';
import type { EditorState, Extension, TransactionSpec } from '@codemirror/state';
import type { App } from 'obsidian';
import { linkTagView, noteItem } from '../../../suggest/candidateView';
import { linkTagCandidates, linkTagWrite, replacedRange, type LinkTagCandidate } from '../../../suggest/LinkTagCandidates';

/** Where a link typed in the editors goes, and what it is spelt from. */
export interface LinkCompletion {
    app: App;
    /** The path of the note a link typed in the editors is written in, asked when it is needed. */
    source(): string;
}

/** A completion option and the candidate it stands for. */
interface LinkTagOption extends Completion {
    candidate: LinkTagCandidate;
}

/**
 * The source editor's link and tag completion: what `TaskNameSuggest`
 * offers on an input, asked of the same `LinkTagCandidates`, over the text
 * of the caret's line before the caret, drawn as that list draws its items
 * (`candidateView.linkTagView`): the item is Obsidian's
 * (`suggestion-item mod-complex`), so Obsidian's CSS lays it out, the
 * folder under the name; CodeMirror's own label is hidden by our CSS
 * (`_source-editor.css`).
 */
export function linkTagCompletion(links: LinkCompletion): Extension {
    return autocompletion({
        override: [linkTagCompletionSource(links)],
        icons: false,
        optionClass: (option) => ['suggestion-item', ...linkTagView((option as LinkTagOption).candidate).classes].join(' '),
        addToOptions: [{
            position: 50,
            render: (option, _state, view) => {
                const holder = view.dom.ownerDocument.createElement('div');
                linkTagView((option as LinkTagOption).candidate).draw(holder);
                const drawn = view.dom.ownerDocument.createDocumentFragment();
                drawn.append(...Array.from(holder.childNodes));
                return drawn;
            },
        }],
    });
}

/**
 * The candidates for the text before the caret, anchored at the trigger
 * (`[[` or `#`) and not filtered again by CodeMirror: they are already the
 * ones that match. A pick writes what `linkTagWrite` makes of it, from the
 * note `links` names at the time of the pick.
 */
export function linkTagCompletionSource(links: LinkCompletion): CompletionSource {
    return (context) => {
        const line = context.state.doc.lineAt(context.pos);
        const found = linkTagCandidates(links.app, line.text.slice(0, context.pos - line.from), links.source());
        if (!found || found.candidates.length === 0) return null;
        return {
            from: line.from + found.start,
            to: context.pos,
            filter: false,
            options: found.candidates.map((candidate): LinkTagOption => ({
                label: labelOf(candidate),
                candidate,
                apply: (view, completion, from, to) =>
                    view.dispatch(completionWrite(view.state, completion, linkTagWrite(links.app, candidate, links.source()), from, to)),
            })),
        };
    };
}

/** What an option is called: the text its item shows first. */
function labelOf(candidate: LinkTagCandidate): string {
    switch (candidate.kind) {
        case 'tag': return candidate.tag;
        case 'heading': return candidate.heading;
        case 'note': return noteItem(candidate.note).title;
    }
}

/**
 * The write of a picked candidate: its replacement over the trigger through
 * the caret, and, for a link, through the closers of its `[[` after the
 * caret (`LinkTagCandidates.replacedRange`), leaving the caret after it.
 */
export function completionWrite(
    state: EditorState, completion: Completion, replacement: string, from: number, to: number,
): TransactionSpec {
    const line = state.doc.lineAt(to);
    const range = replacedRange(line.text, to - line.from, from - line.from);
    return {
        changes: { from: line.from + range.from, to: line.from + range.to, insert: replacement },
        selection: { anchor: line.from + range.from + replacement.length },
        scrollIntoView: true,
        userEvent: 'input.complete',
        annotations: pickedCompletion.of(completion),
    };
}
