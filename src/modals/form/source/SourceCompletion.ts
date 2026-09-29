import { pickedCompletion, type Completion, type CompletionSource } from '@codemirror/autocomplete';
import type { EditorState, TransactionSpec } from '@codemirror/state';
import type { App } from 'obsidian';
import { linkTagCandidates, replacedRange } from '../../../suggest/LinkTagCandidates';

/**
 * The source editor's link and tag completion: what `TaskNameSuggest`
 * offers on an input, asked of the same `LinkTagCandidates`, over the text
 * of the caret's line before the caret. The list is anchored at the trigger
 * (`[[` or `#`), and not filtered again by CodeMirror: the candidates are
 * already the ones that match.
 */
export function linkTagCompletionSource(app: App): CompletionSource {
    return (context) => {
        const line = context.state.doc.lineAt(context.pos);
        const found = linkTagCandidates(app, line.text.slice(0, context.pos - line.from));
        if (!found || found.candidates.length === 0) return null;
        return {
            from: line.from + found.start,
            to: context.pos,
            filter: false,
            options: found.candidates.map((candidate): Completion => ({
                label: candidate.label,
                detail: candidate.detail ?? candidate.folder,
                apply: (view, completion, from, to) =>
                    view.dispatch(completionWrite(view.state, completion, candidate.replacement, from, to)),
            })),
        };
    };
}

/**
 * The write of a picked candidate: its replacement over the trigger through
 * the caret, and through the closers after the caret it writes itself
 * (`LinkTagCandidates.replacedRange`), leaving the caret after it.
 */
export function completionWrite(
    state: EditorState, completion: Completion, replacement: string, from: number, to: number,
): TransactionSpec {
    const line = state.doc.lineAt(to);
    const range = replacedRange(line.text, to - line.from, from - line.from, replacement);
    return {
        changes: { from: line.from + range.from, to: line.from + range.to, insert: replacement },
        selection: { anchor: line.from + range.from + replacement.length },
        scrollIntoView: true,
        userEvent: 'input.complete',
        annotations: pickedCompletion.of(completion),
    };
}
