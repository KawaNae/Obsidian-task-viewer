import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { RangeSet, type Extension, type Text } from '@codemirror/state';
import { CodeFenceTracker } from '../utils/CodeFenceTracker';
import {
    collectGenBlocks,
    type LocatedDiagnostic,
    spreadOverLines,
} from '../services/parsing/gen/GenBlockCollector';
import { parseGenBody } from '../services/parsing/gen/GenBodyParser';
import type { Diagnostic } from '../services/lang/Diagnostic';
import {
    joinSegments,
    type ParseFlowSegmentsResult,
    parseFlowSegments,
    segmentIndexAt,
} from '../services/flow/FlowSegments';
import { childCopyMigrationWarning } from '../services/flow/ChildCopyMigration';
import { collectFlowLineIndices, isFlowLine, matchFlowLine } from '../services/flow/FlowLineScanner';
import { diagnosticText } from '../services/flow/diagnosticText';
import { TaskLineClassifier } from '../services/parsing/utils/TaskLineClassifier';
import { TaskParser } from '../services/parsing/TaskParser';
import { dateBlockDiagnostics } from '../services/parsing/tv-inline/DateBlockDiagnostics';
import {
    inertFlowDiagnostic,
    inertNotationOf,
    type InertNotation,
} from '../services/parsing/tv-inline/InertFlowDiagnostics';

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
 * Editor diagnostics: wavy underlines with hover messages, for both
 * `==>` flow commands (typos, misordered clauses, legacy syntax, type
 * errors) and `@start>end>due` date blocks (date/time constraint rules,
 * structural warnings).
 *
 * Flow is multi-line aware: a flow program is the task line's tail plus
 * its direct `- ==>` child lines, parsed as one joined source (mirrors
 * TreeTaskExtractor.mergeChildFlow). Groups are assembled around the
 * viewport with bounded scans, so a visible flow child line is diagnosed
 * correctly even when its task line is scrolled out of view — and a lone
 * `x3` child segment is NOT a false orphan-modifier.
 *
 * Date blocks are strictly per-line: each visible task line is re-parsed
 * through the real parser chain (see dateBlockDiagnostics), so ownership
 * and verdicts match the scanner exactly.
 *
 * Deliberately TaskIndex-independent — lines are re-parsed, so diagnostics
 * track unsaved text immediately. Results are memoized by source text;
 * both caches are dropped when the parser chain is rebuilt (settings).
 */
export function createDiagnosticsExtension(): Extension {
    const cache = new Map<string, ParseFlowSegmentsResult>();
    const dateCache = new Map<string, Diagnostic[]>();
    const inertCache = new Map<string, InertNotation | null>();
    const CACHE_CAP = 500;

    /**
     * The parse of one flow group, memoized. The program is kept alongside
     * the diagnostics because the migration notice asks what the command
     * says (does it name a block?) rather than how it is written.
     */
    const parseFor = (raws: string[]): ParseFlowSegmentsResult => {
        const key = raws.join('\n');
        const hit = cache.get(key);
        if (hit) return hit;
        if (cache.size >= CACHE_CAP) cache.clear();
        const result = parseFlowSegments(raws);
        cache.set(key, result);
        return result;
    };

    const dateDiagnosticsFor = (lineText: string): Diagnostic[] => {
        const hit = dateCache.get(lineText);
        if (hit) return hit;
        if (dateCache.size >= CACHE_CAP) dateCache.clear();
        const diagnostics = dateBlockDiagnostics(lineText);
        dateCache.set(lineText, diagnostics);
        return diagnostics;
    };

    /** Memoized `inertNotationOf` — same chain-generation lifetime as the rest. */
    const inertNotationFor = (lineText: string): InertNotation | null => {
        const hit = inertCache.get(lineText);
        if (hit !== undefined) return hit;
        if (inertCache.size >= CACHE_CAP) inertCache.clear();
        const notation = inertNotationOf(lineText);
        inertCache.set(lineText, notation);
        return notation;
    };

    /**
     * Per-line code-fence membership, 0-indexed by (line number - 1).
     *
     * The scanner never turns a fenced line into a task or a flow segment
     * (DocumentTreeBuilder feeds the same judgment into TaskBlock), so
     * decorating one here would make the editor claim a command the file
     * does not have.
     *
     * Two readings are OR'd, mirroring DocumentTreeBuilder: the plain one
     * (CommonMark measures the ≤3-space allowance from column 0) and the
     * dedented one (a fence nested under a task carries the list item's
     * indentation). The extractor scopes its dedented reading to one
     * subtree while this runs over the whole document; the two diverge only
     * for a fence that is never closed, and there Obsidian's own renderer
     * also treats the remainder as code.
     *
     * Computed lazily — a viewport with no task, flow or fence line never
     * pays for it — and cached on the doc, which CodeMirror replaces on
     * every change. The `tv-gen` diagnostics ride along: they need the same
     * walk of the same lines, so one pass answers both.
     */
    interface DocAnalysis {
        fenced: boolean[];
        /** `tv-gen` diagnostics bucketed by 0-indexed line. */
        gen: Map<number, LocatedDiagnostic[]>;
    }
    let docCache: { doc: Text; analysis: DocAnalysis } | null = null;
    const analyze = (doc: Text): DocAnalysis => {
        if (docCache?.doc === doc) return docCache.analysis;
        const lines: string[] = [];
        for (let n = 1; n <= doc.lines; n++) lines.push(doc.line(n).text);
        const scan = CodeFenceTracker.scan(lines);
        const dedented = CodeFenceTracker.subtreeMask(lines);

        const { blocks, diagnostics } = collectGenBlocks(lines, scan);
        const gen = new Map<number, LocatedDiagnostic[]>();
        // A js section is several lines, so a diagnostic can span more than
        // one and a mark cannot. Cut into a piece per line before bucketing,
        // so each covered line is decorated on its own terms.
        const bucket = (d: LocatedDiagnostic) => {
            for (const piece of spreadOverLines(d, line => lines[line]?.length ?? 0)) {
                const at = gen.get(piece.line);
                if (at) at.push(piece);
                else gen.set(piece.line, [piece]);
            }
        };
        diagnostics.forEach(bucket);
        for (const block of blocks.values()) {
            parseGenBody(block.body, block.openLine + 1).diagnostics.forEach(bucket);
        }

        const analysis: DocAnalysis = {
            fenced: lines.map((_, i) => scan.fenced[i] || dedented[i]),
            gen,
        };
        docCache = { doc, analysis };
        return analysis;
    };
    const fenceMaskFor = (doc: Text): boolean[] => analyze(doc).fenced;

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
    const collectGroup = (
        view: EditorView,
        rootLineNumber: number,
    ): { segments: SegmentLoc[]; childLines: string[] } | null => {
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

        const mask = fenceMaskFor(doc);
        const fenced = windowLineNumbers.map(n => mask[n - 1]);

        const flowIndices = collectFlowLineIndices(window, 0, fenced);
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
        // The window minus the root is the task's child block, which the
        // migration notice weighs. It comes from here rather than from a
        // second walk: where a child block ends is one rule, and reading it
        // twice is how the two readings start to differ.
        return { segments, childLines: window.slice(1) };
    };

    const buildDecorations = (view: EditorView): DecorationSet => {
        const marks: { from: number; to: number; deco: Decoration }[] = [];
        const seenRoots = new Set<number>();

        for (const { from, to } of view.visibleRanges) {
            let pos = from;
            while (pos <= to) {
                const line = view.state.doc.lineAt(pos);
                pos = line.to + 1;

                // Block diagnostics anchor on the delimiter and on body
                // lines, neither of which is a task or flow line — so they
                // run before the fence guard below rather than through it.
                {
                    for (const d of analyze(view.state.doc).gen.get(line.number - 1) ?? []) {
                        const from = line.from + d.span.start;
                        const to = Math.min(line.from + d.span.end, line.to);
                        if (to <= from) continue;
                        marks.push({
                            from,
                            to,
                            deco: Decoration.mark({
                                class: `tv-diag tv-diag--${d.severity}`,
                                attributes: { title: diagnosticText(d) },
                            }),
                        });
                    }
                }

                const isTaskLine = TaskLineClassifier.isTaskLine(line.text);

                // A fenced line is an example, not notation: the scanner
                // parses neither its date block nor its `==>`. Checked here,
                // once, for both halves of the extension — and only for
                // lines that would otherwise be decorated, so the mask stays
                // uncomputed on ordinary prose.
                if ((isTaskLine || isFlowLine(line.text))
                    && fenceMaskFor(view.state.doc)[line.number - 1]) {
                    continue;
                }

                // Date-block diagnostics: strictly per-line, so they run for
                // every visible task line — BEFORE the flow-root shortcuts
                // below (a task line without flow continues out early there).
                if (isTaskLine) {
                    for (const d of dateDiagnosticsFor(line.text)) {
                        const from = line.from + d.span.start;
                        const to = Math.min(line.from + d.span.end, line.to);
                        if (to <= from) continue;
                        marks.push({
                            from,
                            to,
                            deco: Decoration.mark({
                                class: `tv-diag tv-diag--${d.severity}`,
                                attributes: { title: diagnosticText(d) },
                            }),
                        });
                    }
                }

                let rootNumber: number | null = null;
                if (isTaskLine) {
                    rootNumber = line.number;
                } else if (isFlowLine(line.text)) {
                    rootNumber = findOwnerTaskLine(view, line.number);
                }
                if (rootNumber === null || seenRoots.has(rootNumber)) continue;
                seenRoots.add(rootNumber);

                const group = collectGroup(view, rootNumber);
                if (!group) continue;
                const { segments, childLines } = group;
                // Skip the degenerate "bare trailing ==> with nothing anywhere"
                // — the parser treats a lone marker as content, not a command.
                if (segments.length === 1 && !segments[0].raw.trim()) continue;

                // A read-only notation owns this task line: the command never
                // fires, so say that instead of grading its syntax. Every
                // segment of the group is marked, the task line's own tail
                // and its `- ==>` children alike.
                const notation = inertNotationFor(view.state.doc.line(rootNumber).text);
                if (notation) {
                    const d = inertFlowDiagnostic(notation, { start: 0, end: 0 });
                    for (const seg of segments) {
                        if (seg.markerCol === null) continue;
                        const segLine = view.state.doc.line(seg.lineNumber);
                        marks.push({
                            from: segLine.from + seg.markerCol,
                            to: segLine.to,
                            deco: Decoration.mark({
                                class: `tv-diag tv-diag--${d.severity}`,
                                attributes: { title: diagnosticText(d) },
                            }),
                        });
                    }
                    continue;
                }

                const raws = segments.map(s => s.raw);
                const { table } = joinSegments(raws);
                const parsed = parseFor(raws);

                // The children stopped travelling with the command. Nothing
                // in the text says so, which is why it is said here; the mark
                // covers the command because that is what has to change.
                const migration = parsed.program
                    && childCopyMigrationWarning(parsed.program, childLines, parsed.diagnostics);
                if (migration) {
                    const anchor = segments.find(s => s.markerCol !== null);
                    if (anchor) {
                        const anchorLine = view.state.doc.line(anchor.lineNumber);
                        marks.push({
                            from: anchorLine.from + anchor.markerCol!,
                            to: anchorLine.to,
                            deco: Decoration.mark({
                                class: `tv-diag tv-diag--${migration.severity}`,
                                attributes: { title: diagnosticText(migration) },
                            }),
                        });
                    }
                }

                for (const d of parsed.diagnostics) {
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
                            class: `tv-diag tv-diag--${d.severity}`,
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
            chainGeneration = TaskParser.getChainGeneration();

            constructor(view: EditorView) {
                this.decorations = buildDecorations(view);
            }

            update(update: ViewUpdate) {
                // A parser-chain rebuild (settings change) invalidates date
                // ownership/verdicts — drop both caches and redecorate.
                // Clearing shared caches from multiple editors is idempotent.
                const generation = TaskParser.getChainGeneration();
                if (generation !== this.chainGeneration) {
                    this.chainGeneration = generation;
                    cache.clear();
                    dateCache.clear();
                    inertCache.clear();
                    this.decorations = buildDecorations(update.view);
                } else if (update.docChanged || update.viewportChanged) {
                    this.decorations = buildDecorations(update.view);
                }
            }
        },
        {
            decorations: (v) => v.decorations,
        }
    );
}
