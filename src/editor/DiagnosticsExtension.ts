import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { RangeSet, type Extension, type Text } from '@codemirror/state';
import { outlineFor } from './EditorOutline';
import { flowGroupOf, flowOwnerOf } from './FlowGroup';
import {
    collectGenBlocks,
    type LocatedDiagnostic,
    spreadOverLines,
} from '../services/parsing/gen/GenBlockCollector';
import { parseGenBody } from '../services/parsing/gen/GenBodyParser';
import { declaredCells } from '../services/parsing/gen/GenCellScan';
import { type HighlightMark, highlightGenBody } from '../services/parsing/gen/GenHighlight';
import type { Diagnostic } from '../services/lang/Diagnostic';
import {
    joinSegments,
    type ParseFlowSegmentsResult,
    parseFlowSegments,
    segmentIndexAt,
} from '../services/flow/FlowSegments';
import { childCopyMigrationWarning } from '../services/flow/ChildCopyMigration';
import { FLOW_MARKER, isFlowLine, matchFlowLine } from '../services/parsing/utils/FlowLineScanner';
import { diagnosticText } from '../services/flow/diagnosticText';
import { TaskLineClassifier } from '../services/parsing/utils/TaskLineClassifier';
import { TaskParser } from '../services/parsing/TaskParser';
import { dateBlockDiagnostics } from '../services/parsing/tv-inline/DateBlockDiagnostics';
import {
    inertFlowDiagnostic,
    inertNotationOf,
    type InertNotation,
} from '../services/parsing/tv-inline/InertFlowDiagnostics';

/**
 * Look up `key` in `cache`, computing and storing it on a miss. The cache is
 * cleared entirely once it grows past `cap` — a blunt but simple bound for a
 * long editing session, not an LRU (repeatedly-hot keys just get recomputed
 * once after each clear).
 */
function memoize<K, V>(cache: Map<K, V>, cap: number, key: K, compute: () => V): V {
    const hit = cache.get(key);
    if (hit !== undefined || cache.has(key)) return hit as V;
    if (cache.size >= cap) cache.clear();
    const value = compute();
    cache.set(key, value);
    return value;
}

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
    const parseFor = (raws: string[]): ParseFlowSegmentsResult =>
        memoize(cache, CACHE_CAP, raws.join('\n'), () => parseFlowSegments(raws));

    const dateDiagnosticsFor = (lineText: string): Diagnostic[] =>
        memoize(dateCache, CACHE_CAP, lineText, () => dateBlockDiagnostics(lineText));

    /** Memoized `inertNotationOf` — same chain-generation lifetime as the rest. */
    const inertNotationFor = (lineText: string): InertNotation | null =>
        memoize(inertCache, CACHE_CAP, lineText, () => inertNotationOf(lineText));

    /**
     * The note's reading (list items, subtrees, code) and its per-doc cache
     * live in EditorOutline, shared with every extension that must not
     * decorate what the parser does not read as notation. The scanner never
     * turns a line in code, or a line that opens no list item, into a task
     * or a flow segment (DocumentTreeBuilder reads the same reading), so
     * decorating one here would make the editor claim a command the file
     * does not have.
     *
     * DocAnalysis itself is computed lazily — a viewport with no task, flow
     * or fence line never pays for it — and cached on the doc, which
     * CodeMirror replaces on every change. The `tv-gen` diagnostics ride
     * along: they need the same walk of the same lines, so one pass answers
     * both.
     */
    interface DocAnalysis {
        /** `tv-gen` diagnostics bucketed by 0-indexed line. */
        gen: Map<number, LocatedDiagnostic[]>;
        /**
         * What each run of a `tv-gen` block is, bucketed by 0-indexed line.
         *
         * Read off the same parse as the diagnostics above. Reading the block
         * a second time to colour it is what would let the colour and the
         * squiggle describe two different readings of one line.
         */
        tokens: Map<number, HighlightMark[]>;
    }
    let docCache: { doc: Text; analysis: DocAnalysis } | null = null;
    const analyze = (doc: Text): DocAnalysis => {
        if (docCache?.doc === doc) return docCache.analysis;
        const lines: string[] = [];
        for (let n = 1; n <= doc.lines; n++) lines.push(doc.line(n).text);
        // The reading is made once and shared across every editor extension
        // via EditorOutline — asking it here rather than reading again keeps
        // this analysis and TaskMenuExtension's from ever answering "is this
        // line code" differently.
        const { blocks, diagnostics } = collectGenBlocks(lines, outlineFor(doc));
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
        const cells = blocks.size > 0
            ? declaredCells(lines, outlineFor(doc))
            : undefined;
        const tokens = new Map<number, HighlightMark[]>();
        for (const block of blocks.values()) {
            const body = parseGenBody(block.body, block.openLine + 1, cells);
            // Includes the two GeneratedLineCheck warnings a block can
            // already earn at fire time (a completed parent, a checked
            // child with its own command) — parseGenBody's classify reads
            // them off these same literal lines, so a mistyped status shows
            // before the block ever fires.
            body.diagnostics.forEach(bucket);
            for (const mark of highlightGenBody(body)) {
                const at = tokens.get(mark.line);
                if (at) at.push(mark);
                else tokens.set(mark.line, [mark]);
            }
        }

        const analysis: DocAnalysis = { gen, tokens };
        docCache = { doc, analysis };
        return analysis;
    };

    /**
     * Assemble the flow group rooted at a task line: segment 0 is the task
     * line's tail after `==>` ('' without a marker), followed by the direct
     * flow child lines. Which lines those are, and where the child block
     * ends, is asked of the note's one reading (`flowGroupOf`), as the
     * parser asks it. Returns null when the task has no flow at all.
     */
    const collectGroup = (
        view: EditorView,
        rootLineNumber: number,
    ): { segments: SegmentLoc[]; childLines: string[] } | null => {
        const doc = view.state.doc;
        const rootText = doc.line(rootLineNumber).text;
        const markerIdx = rootText.indexOf(FLOW_MARKER);

        const { flowLines, childLines } = flowGroupOf(outlineFor(doc), rootLineNumber - 1);
        if (markerIdx === -1 && flowLines.length === 0) return null;

        const seg0: SegmentLoc = markerIdx >= 0
            ? {
                lineNumber: rootLineNumber,
                tailStart: markerIdx + FLOW_MARKER.length,
                markerCol: markerIdx,
                raw: rootText.slice(markerIdx + FLOW_MARKER.length),
            }
            : { lineNumber: rootLineNumber, tailStart: rootText.length, markerCol: null, raw: '' };

        const segments: SegmentLoc[] = [seg0];
        for (const line of flowLines) {
            const text = doc.line(line + 1).text;
            const m = matchFlowLine(text);
            if (!m) continue;
            segments.push({
                lineNumber: line + 1,
                tailStart: m.tailStart,
                markerCol: text.indexOf(FLOW_MARKER),
                raw: m.tail,
            });
        }
        return { segments, childLines };
    };

    const buildDecorations = (view: EditorView): DecorationSet => {
        const marks: { from: number; to: number; deco: Decoration }[] = [];
        const seenRoots = new Set<number>();

        for (const { from, to } of view.visibleRanges) {
            let pos = from;
            while (pos <= to) {
                const line = view.state.doc.lineAt(pos);
                pos = line.to + 1;

                // What the block's own words are, under the squiggles. Drawn
                // first so a diagnostic's mark nests inside a colour's rather
                // than the other way round: the colour is what the run is, the
                // squiggle is what is wrong with it, and the inner one wins
                // the property they share.
                for (const mark of analyze(view.state.doc).tokens.get(line.number - 1) ?? []) {
                    const from = line.from + mark.from;
                    const to = Math.min(line.from + mark.to, line.to);
                    if (to <= from) continue;
                    marks.push({ from, to, deco: Decoration.mark({ class: `tv-tok tv-tok--${mark.role}` }) });
                }

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
                const flowLine = !isTaskLine && isFlowLine(line.text);
                if (!isTaskLine && !flowLine) continue;

                // A line in code is an example, and a line that opens no list
                // item is a paragraph going on: the scanner parses neither
                // its date block nor its `==>`. Checked here, once, for both
                // halves of the extension — and only for lines that would
                // otherwise be decorated, so the reading stays unmade on
                // ordinary prose.
                const outline = outlineFor(view.state.doc);
                if (outline.inCode(line.number - 1) || outline.item(line.number - 1) === null) continue;

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
                } else {
                    const owner = flowOwnerOf(outline, line.number - 1);
                    rootNumber = owner === null ? null : owner + 1;
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
