import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { RangeSet, type Extension } from '@codemirror/state';
import { Diagnostic } from '../services/lang/Diagnostic';
import { joinSegments, parseFlowSegments, segmentIndexAt } from '../services/flow/FlowSegments';
import { collectFlowLineIndices, isFlowLine, matchFlowLine } from '../services/flow/FlowLineScanner';
import { diagnosticText } from '../services/flow/diagnosticText';
import { TaskLineClassifier } from '../services/parsing/utils/TaskLineClassifier';

const FLOW_MARKER = '==>';
/** Bound for the up/down document scans around the viewport. */
const SCAN_LIMIT = 100;

/** One physical segment of a flow group, located in the editor document. */
interface SegmentLoc {
    /** 1-based CM line number. */
    lineNumber: number;
    /** Column where the (untrimmed) tail after `==>` begins. */
    tailStart: number;
    /** Column of the `==>` marker (null: task line without a marker). */
    markerCol: number | null;
    /** Untrimmed tail text — the segment source. */
    raw: string;
}

/**
 * Editor diagnostics for `==>` flow commands: wavy underlines with hover
 * messages on typos, misordered clauses, legacy syntax, and type errors.
 *
 * Multi-line aware: a flow program is the task line's tail plus its direct
 * `- ==>` child lines, parsed as one joined source (mirrors
 * TreeTaskExtractor.mergeChildFlow). Groups are assembled around the
 * viewport with bounded scans, so a visible flow child line is diagnosed
 * correctly even when its task line is scrolled out of view — and a lone
 * `x3` child segment is NOT a false orphan-modifier.
 *
 * Deliberately TaskIndex-independent — lines are re-parsed with the pure
 * flow parser, so diagnostics track unsaved text immediately. Results are
 * memoized by the joined source, so scrolling costs no re-parses.
 */
export function createFlowDiagnosticsExtension(): Extension {
    const cache = new Map<string, Diagnostic[]>();
    const CACHE_CAP = 500;

    const diagnosticsFor = (raws: string[]): Diagnostic[] => {
        const key = raws.join('\n');
        const hit = cache.get(key);
        if (hit) return hit;
        if (cache.size >= CACHE_CAP) cache.clear();
        const diagnostics = parseFlowSegments(raws).diagnostics;
        cache.set(key, diagnostics);
        return diagnostics;
    };

    /**
     * Owner task line of a flow child line: its structural parent (nearest
     * preceding non-blank line with smaller indent) when that is a task
     * line. Flow lines nested under notes/checkbox-less structures have no
     * owner here and get no decorations.
     */
    const findOwnerTaskLine = (view: EditorView, lineNumber: number): number | null => {
        const doc = view.state.doc;
        const flowIndent = doc.line(lineNumber).text.search(/\S|$/);
        let steps = 0;
        for (let n = lineNumber - 1; n >= 1 && steps < SCAN_LIMIT; n--, steps++) {
            const text = doc.line(n).text;
            if (text.trim() === '') return null; // blank ends the child block
            const indent = text.search(/\S|$/);
            if (indent < flowIndent) {
                return TaskLineClassifier.isTaskLine(text) ? n : null;
            }
        }
        return null;
    };

    /**
     * Assemble the flow group rooted at a task line: segment 0 is the task
     * line's tail after `==>` ('' without a marker), followed by the direct
     * flow child lines (ownership shared with the extractor via
     * collectFlowLineIndices). Returns null when the task has no flow at all.
     */
    const collectGroup = (view: EditorView, rootLineNumber: number): SegmentLoc[] | null => {
        const doc = view.state.doc;
        const rootText = doc.line(rootLineNumber).text;
        const rootIndent = rootText.search(/\S|$/);
        const markerIdx = rootText.indexOf(FLOW_MARKER);

        const window: string[] = [rootText];
        const windowLineNumbers: number[] = [rootLineNumber];
        for (let n = rootLineNumber + 1; n <= doc.lines && window.length <= SCAN_LIMIT; n++) {
            const text = doc.line(n).text;
            if (text.trim() === '') break;
            if (text.search(/\S|$/) <= rootIndent) break;
            window.push(text);
            windowLineNumbers.push(n);
        }

        const flowIndices = collectFlowLineIndices(window, 0);
        if (markerIdx === -1 && flowIndices.length === 0) return null;

        const seg0: SegmentLoc = markerIdx >= 0
            ? {
                lineNumber: rootLineNumber,
                tailStart: markerIdx + FLOW_MARKER.length,
                markerCol: markerIdx,
                raw: rootText.slice(markerIdx + FLOW_MARKER.length),
            }
            : { lineNumber: rootLineNumber, tailStart: rootText.length, markerCol: null, raw: '' };

        const segments: SegmentLoc[] = [seg0];
        for (const k of flowIndices) {
            const text = window[k];
            const m = matchFlowLine(text);
            if (!m) continue;
            segments.push({
                lineNumber: windowLineNumbers[k],
                tailStart: m.tailStart,
                markerCol: text.indexOf(FLOW_MARKER),
                raw: m.tail,
            });
        }
        return segments;
    };

    const buildDecorations = (view: EditorView): DecorationSet => {
        const marks: { from: number; to: number; deco: Decoration }[] = [];
        const seenRoots = new Set<number>();

        for (const { from, to } of view.visibleRanges) {
            let pos = from;
            while (pos <= to) {
                const line = view.state.doc.lineAt(pos);
                pos = line.to + 1;

                let rootNumber: number | null = null;
                if (TaskLineClassifier.isTaskLine(line.text)) {
                    rootNumber = line.number;
                } else if (isFlowLine(line.text)) {
                    rootNumber = findOwnerTaskLine(view, line.number);
                }
                if (rootNumber === null || seenRoots.has(rootNumber)) continue;
                seenRoots.add(rootNumber);

                const segments = collectGroup(view, rootNumber);
                if (!segments) continue;
                // Skip the degenerate "bare trailing ==> with nothing anywhere"
                // — the parser treats a lone marker as content, not a command.
                if (segments.length === 1 && !segments[0].raw.trim()) continue;

                const raws = segments.map(s => s.raw);
                const { table } = joinSegments(raws);
                for (const d of diagnosticsFor(raws)) {
                    const segIdx = Math.min(segmentIndexAt(table, d.span.start), segments.length - 1);
                    const seg = segments[segIdx];
                    const segLine = view.state.doc.line(seg.lineNumber);

                    let fromPos: number;
                    let toPos: number;
                    const zeroWidth = d.span.end <= d.span.start;
                    if (zeroWidth) {
                        // Anchor on the segment's own `==>` marker; a
                        // marker-less task-line segment falls back to the
                        // first child line's marker.
                        const anchor = seg.markerCol !== null
                            ? seg
                            : segments.find(s => s.markerCol !== null);
                        if (!anchor) continue;
                        const anchorLine = view.state.doc.line(anchor.lineNumber);
                        fromPos = anchorLine.from + anchor.markerCol!;
                        toPos = anchorLine.from + anchor.tailStart;
                    } else {
                        const local = d.span.start - table.spans[segIdx].start;
                        const localEnd = d.span.end - table.spans[segIdx].start;
                        fromPos = segLine.from + seg.tailStart + local;
                        // A span may legitimately cross the segment end
                        // (flow.node-spans-lines) — clamp to the line.
                        toPos = Math.min(segLine.from + seg.tailStart + localEnd, segLine.to);
                    }
                    if (toPos <= fromPos) continue;

                    marks.push({
                        from: fromPos,
                        to: toPos,
                        deco: Decoration.mark({
                            class: `tv-flow-diag tv-flow-diag--${d.severity}`,
                            attributes: { title: diagnosticText(d) },
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
