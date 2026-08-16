import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { EvalContext } from '../../../src/services/lang/ExprEvaluator';
import type { EvalHost, StaticType } from '../../../src/services/lang/functions';
import type { CellStore } from '../../../src/services/lang/StmtEvaluator';
import { type Value, valueToLiteral } from '../../../src/services/lang/Value';
import { parseGenBody } from '../../../src/services/parsing/gen/GenBodyParser';
import { renderGenBody } from '../../../src/services/parsing/gen/GenBodyRenderer';

/**
 * A runner for probing the expression language from outside.
 *
 * Written for a reader who does not know the implementation: they write what
 * they would naively try, run this, and read what came back. The point is the
 * failures that are hard to understand — `String(g)`, `g.toString()`, the
 * shapes a JS habit reaches for — so the answers have to come from the product
 * path and not from a summary of it. Every entry is rendered as a real
 * generation block with real cells, which is the same code a firing runs.
 *
 * Paths are fixed and outside any one session's scratch, so an agent in any
 * worktree can be told them once. Both can be overridden by environment
 * variables when a run needs its own corpus.
 *
 * A missing or empty corpus is a pass that writes an empty result: the file is
 * evergreen, so it lives in the ordinary suite rather than in a place someone
 * has to remember to run.
 */

const PROBE_DIR = 'C:/Users/KawaNae/AppData/Local/Temp/claude/C--VScode-obsidian-task-viewer/naive-probe';
const IN = process.env.NAIVE_PROBE_IN ?? `${PROBE_DIR}/corpus.json`;
const OUT = process.env.NAIVE_PROBE_OUT ?? `${PROBE_DIR}/result.json`;

/** One thing to try. `expr` is what goes inside an interpolation. */
interface ProbeEntry {
    id: string;
    /** Cells the flow line declares, by their starting value (JSON scalars). */
    cells?: Record<string, string | number | boolean>;
    /** The js section, without the `<js` / `/js>` delimiters. */
    js?: string;
    expr: string;
}

interface ProbeResult {
    id: string;
    ok: boolean;
    /** Canonical literal of what the expression came to, when it came to one. */
    value?: string;
    /** What stopped it: a diagnostic the checker drew, or a failure while running. */
    error?: { kind: 'diagnostic' | 'eval'; code: string | null; message: string };
    /**
     * The cells as the block left them, printed the way the command would
     * carry them. Present only when the entry declared some — an assignment is
     * an expression here, so what it wrote is half the answer.
     */
    cells?: string[];
    /** Everything the checker said, warnings included — often the answer itself. */
    diagnostics?: { severity: string; code: string; message: string }[];
}

const host: EvalHost = {
    formatDate: (value, tokens) => `[${tokens}:${value.type === 'date' ? value.value : '?'}]`,
};

/** The context a firing builds, with a date block a probe can read. */
function context(cells: CellStore): EvalContext {
    return {
        props: {
            content: { type: 'string', value: 'probe' },
            'file.name': { type: 'string', value: 'probe' },
            done: { type: 'datetime', date: '2026-08-16', time: '10:00' },
            today: { type: 'date', value: '2026-08-16' },
            start: { type: 'date', value: '2026-08-17' },
        },
        today: '2026-08-16',
        now: { date: '2026-08-16', time: '10:00' },
        weekStartDay: 1,
        host,
        cells,
    };
}

function cellsOf(entry: ProbeEntry): CellStore {
    const store: CellStore = new Map();
    for (const [name, raw] of Object.entries(entry.cells ?? {})) {
        store.set(name, valueOf(raw));
    }
    return store;
}

/** A JSON scalar as a value of the language. */
function valueOf(raw: string | number | boolean): Value {
    if (typeof raw === 'number') return { type: 'number', value: raw };
    if (typeof raw === 'boolean') return { type: 'bool', value: raw };
    return { type: 'string', value: raw };
}

function cellTypes(cells: CellStore): ReadonlyMap<string, StaticType> {
    const types = new Map<string, StaticType>();
    for (const [name, value] of cells) {
        if (value.type === 'array' || value.type === 'record') continue;
        types.set(name, value.type);
    }
    return types;
}

/**
 * Run one entry the way a fire would.
 *
 * The expression is the whole of a generated task line, so what comes back is
 * the line minus its marker. A checkbox line is what a block has to produce,
 * and writing the probe as one keeps the path identical to the real thing
 * rather than nearly identical.
 */
function run(entry: ProbeEntry): ProbeResult {
    const cells = cellsOf(entry);
    const lines: string[] = [];
    if (entry.js !== undefined) lines.push('<js', ...entry.js.split('\n'), '/js>');
    lines.push('- [ ] ${' + entry.expr + '}');

    const body = parseGenBody(lines, 1, cellTypes(cells));
    const diagnostics = body.diagnostics.map(d => ({
        severity: d.severity, code: d.code, message: d.message,
    }));
    const broken = body.diagnostics.find(d => d.severity === 'error');
    if (broken) {
        return {
            id: entry.id,
            ok: false,
            error: { kind: 'diagnostic', code: broken.code, message: broken.message },
            diagnostics,
        };
    }

    let rendered;
    try {
        rendered = renderGenBody(body, context(cells));
    } catch (e) {
        // A throw that is not an EvalError is a defect in the engine, and
        // saying so beats a probe that reports it as a language rule.
        return {
            id: entry.id,
            ok: false,
            error: { kind: 'eval', code: null, message: `unexpected throw: ${String(e)}` },
            diagnostics,
        };
    }
    if (!rendered.ok) {
        // A runtime failure carries a span and a sentence, not a code — the
        // codes belong to the checker, and saying null is truer than inventing
        // one for a reader comparing the two kinds of answer.
        return {
            id: entry.id,
            ok: false,
            error: { kind: 'eval', code: null, message: rendered.error.message },
            diagnostics,
        };
    }

    const line = rendered.parentText ?? '';
    // What the block left, not what it started from: the store handed in is a
    // copy and stays as written.
    const written = [...rendered.cells].map(([name, value]) => `${name}: ${valueToLiteral(value)}`);
    return {
        id: entry.id,
        ok: true,
        value: line.replace(/^- \[ \] /, ''),
        ...(written.length ? { cells: written } : {}),
        diagnostics,
    };
}

function readCorpus(): ProbeEntry[] {
    if (!existsSync(IN)) return [];
    const text = readFileSync(IN, 'utf8').trim();
    if (text === '') return [];
    const parsed = JSON.parse(text);
    // A bare array, or an object with an `entries` key — a reader writing the
    // corpus by hand should not have to guess which.
    return Array.isArray(parsed) ? parsed : parsed.entries ?? [];
}

describe('naive probe runner', () => {
    it('answers every entry of the corpus', () => {
        const entries = readCorpus();
        const results = entries.map(entry => {
            try {
                return run(entry);
            } catch (e) {
                // The runner itself failing must not take the other entries
                // down: a corpus is written by someone who does not know what
                // this engine refuses.
                return {
                    id: entry?.id ?? '(no id)',
                    ok: false,
                    error: { kind: 'eval' as const, code: null, message: `runner: ${String(e)}` },
                };
            }
        });
        mkdirSync(dirname(OUT), { recursive: true });
        writeFileSync(OUT, JSON.stringify({ input: IN, count: results.length, results }, null, 2), 'utf8');
        expect(results.length).toBe(entries.length);
    });
});
