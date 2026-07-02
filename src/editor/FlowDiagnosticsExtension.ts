import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { RangeSet, type Extension } from '@codemirror/state';
import { Diagnostic } from '../services/lang/Diagnostic';
import { parseFlow } from '../services/flow/FlowParser';
import { TaskLineClassifier } from '../services/parsing/utils/TaskLineClassifier';

const FLOW_MARKER = '==>';

/**
 * Editor diagnostics for `==>` flow commands: wavy underlines with hover
 * messages on typos, misordered clauses, legacy syntax, and type errors.
 *
 * Deliberately TaskIndex-independent — visible lines are re-parsed with the
 * pure flow parser, so diagnostics track unsaved text immediately. Results
 * are memoized by raw flow text, so scrolling costs no re-parses.
 */
export function createFlowDiagnosticsExtension(): Extension {
    const cache = new Map<string, Diagnostic[]>();
    const CACHE_CAP = 500;

    const diagnosticsFor = (raw: string): Diagnostic[] => {
        const hit = cache.get(raw);
        if (hit) return hit;
        if (cache.size >= CACHE_CAP) cache.clear();
        const diagnostics = parseFlow(raw).diagnostics;
        cache.set(raw, diagnostics);
        return diagnostics;
    };

    const buildDecorations = (view: EditorView): DecorationSet => {
        const marks: { from: number; to: number; deco: Decoration }[] = [];
        const seen = new Set<number>();

        for (const { from, to } of view.visibleRanges) {
            let pos = from;
            while (pos <= to) {
                const line = view.state.doc.lineAt(pos);
                pos = line.to + 1;
                if (seen.has(line.number)) continue;
                seen.add(line.number);

                const text = line.text;
                const markerIdx = text.indexOf(FLOW_MARKER);
                if (markerIdx === -1 || !TaskLineClassifier.isTaskLine(text)) continue;

                const tailStart = markerIdx + FLOW_MARKER.length;
                const tail = text.slice(tailStart);
                if (!tail.trim()) continue;

                for (const d of diagnosticsFor(tail)) {
                    // Zero-width spans (e.g. unexpected end of input) anchor
                    // on the `==>` marker itself.
                    const zeroWidth = d.span.end <= d.span.start;
                    const fromPos = zeroWidth ? line.from + markerIdx : line.from + tailStart + d.span.start;
                    const toPos = zeroWidth ? line.from + tailStart : line.from + tailStart + d.span.end;
                    marks.push({
                        from: fromPos,
                        to: Math.min(toPos, line.to),
                        deco: Decoration.mark({
                            class: `tv-flow-diag tv-flow-diag--${d.severity}`,
                            attributes: { title: d.message },
                        }),
                    });
                }
            }
        }

        marks.sort((a, b) => a.from - b.from || a.to - b.to);
        return RangeSet.of(marks.map(m => m.deco.range(m.from, m.to)), true);
    };

    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;

            constructor(view: EditorView) {
                this.decorations = buildDecorations(view);
            }

            update(update: ViewUpdate) {
                if (update.docChanged || update.viewportChanged) {
                    this.decorations = buildDecorations(update.view);
                }
            }
        },
        {
            decorations: (v) => v.decorations,
        }
    );
}
