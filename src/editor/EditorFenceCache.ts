/**
 * Shared, doc-identity-cached fence analysis for CM6 editor extensions.
 *
 * The OR formula and its cache live here once, so every extension that
 * needs to skip decorating inside a fence reads the same answer instead of
 * each keeping its own copy that can drift out of sync. Cached on the CM6
 * `Text` object's identity: a pure viewport/scroll update keeps the same
 * `Text`, so repeated calls across a scroll reuse the cached analysis
 * instead of rescanning the whole document.
 *
 * Two readings are OR'd, mirroring DocumentTreeBuilder: the plain one
 * (CommonMark measures the ≤3-space allowance from column 0) and the
 * dedented one (a fence nested under a task carries the list item's
 * indentation, invisible to the plain reading). The two diverge only for a
 * fence that is never closed, and there Obsidian's own renderer also treats
 * the remainder as code.
 */
import type { Text } from '@codemirror/state';
import { CodeFenceTracker, type FenceScan } from '../utils/CodeFenceTracker';

interface FenceAnalysis {
    scan: FenceScan;
    mask: boolean[];
}

let cache: { doc: Text; analysis: FenceAnalysis } | null = null;

function analyze(doc: Text): FenceAnalysis {
    if (cache?.doc === doc) return cache.analysis;

    const lines: string[] = [];
    for (let n = 1; n <= doc.lines; n++) lines.push(doc.line(n).text);

    const scan = CodeFenceTracker.scan(lines);
    const subtree = CodeFenceTracker.subtreeMask(lines);
    const mask = lines.map((_, i) => scan.fenced[i] || subtree[i]);

    const analysis: FenceAnalysis = { scan, mask };
    cache = { doc, analysis };
    return analysis;
}

/**
 * Per-line fence membership (document fences OR'd with subtree/indented
 * ones) for the given CM6 document.
 */
export function fenceMaskFor(doc: Text): boolean[] {
    return analyze(doc).mask;
}

/**
 * The underlying document-level fence scan (with opening-delimiter
 * metadata), for callers that need more than plain membership — e.g. the
 * tv-gen block collector, which reads each fence's info string.
 */
export function fenceScanFor(doc: Text): FenceScan {
    return analyze(doc).scan;
}
