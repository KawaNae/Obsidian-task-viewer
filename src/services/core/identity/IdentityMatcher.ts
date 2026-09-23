import type { Task } from '../../../types';
import type { Fingerprint } from './IdentityFingerprint';
import { fingerprintOf } from './IdentityFingerprint';
import type { Reading } from './IdentityHints';
import { reproduces } from './IdentityHints';
import type { LedgerEntry } from './IdentityLedger';

export interface MatchResult {
    /** Provisional (parse-time) ID → runtime ID. Covers every task passed in. */
    mapping: Map<string, string>;
    /** The file's new ledger rows, in file order (`task.line` ascending). */
    entries: LedgerEntry[];
    /** Runtime IDs this run gave rows that the previous rows did not hold, in file order. */
    minted: string[];
    /** Previous runtime IDs nothing matched. They are gone for good. */
    retired: string[];
    /**
     * Previous rows whose fate position decided, each with how many rows it
     * was one of: every previous row of a bucket that held more than one row
     * on either side, where nearest ordinal is what decided. The row position
     * left unpaired is in here too — that it was the one to go is as much a
     * guess as which line the other one got. So is a row paired later — by
     * a weaker rung, or in the second pass — with a line position left over in
     * such a bucket: that the line was left over is where the guess went.
     * And so is every row paired inside the children of a row position
     * decided: which parent's scope a child was looked for in is the guess
     * again, however unique the child is there.
     *
     * A scan does not read this to decide identity — for identity, a guess by
     * position is the documented best it can do. A write does (see
     * `TaskScanner.locate`): writing on a line chosen by position is writing
     * on a guess, and a write would rather not write at all. The ledger keeps
     * what a committing scan guessed (`IdentityLedger.guessedFor`) for the
     * consumers that must know which rows were guessed after the fact.
     */
    guessed: Map<string, number>;
    /**
     * Names the readings of the lines disagreed about: some reading gave the
     * name to a row, another gave that row another name or put the name
     * elsewhere, so no row carries it now. A write that asks for one is
     * asking for a row that cannot be told (`ambiguous`).
     */
    disputed: Set<string>;
}

/**
 * Match the previous scan's rows for one file against this scan's tasks and
 * decide which tasks keep their runtime ID.
 *
 * `reading` says every way the lines may be told (see `WriteClaims.reading`):
 * as one of the known states whose content they are — the ledger's, a write's
 * of ours — and, when a change nobody reported may have come after the newest
 * of them, as that change, which the ladder pairs against `reading.partner`.
 *
 * A known state that reproduces the read decides every row outright: line i
 * is whatever the state says line i is, and a row it no longer holds is one
 * that went. The ladder is the fallback, for lines no known state has, and it
 * answers by evidence, strongest first:
 *
 * Two passes. The first walks the tree from the roots down, running the ladder
 * inside one scope (the children of one matched parent) at a time, so a group of
 * identically-worded siblings can only collide with its own group — the recurrence
 * writer inserts each new instance at the *head* of its sibling group, and a flat
 * file-wide match would slide every card down by one. The second pass runs the same
 * ladder once over whatever is left, which is how a task whose parent changed (or
 * whose parent's text was merely edited) is rescued instead of being renumbered.
 *
 * With one reading open, its answer is the answer. With more than one — two
 * known states with the same content, or a known state and a change after
 * the newest one — which of them the read is cannot be told from the lines,
 * and a row keeps a name only where every reading that names the row gives it
 * that name, and none puts that name on another row. Everywhere else the row
 * is new. A reading that leaves a row unnamed (the ladder found no evidence)
 * has nothing to say about it and does not stand in the way; one that names
 * the row otherwise does. This is the rule a claim was always held to — a
 * decision is taken only when no candidate decides differently — kept row by
 * row: rows the readings agree on are right whichever reading is true.
 *
 * `reading` is not optional. A caller that could leave it out would be one
 * that forgot the writes it knows of, and the ladder would pair against a
 * state older than the file without anyone noticing.
 *
 * Pure and deterministic: no clock, no randomness, no I/O. Minting is the caller's,
 * through `mintRuntimeId`.
 */
export function matchFile(
    previous: LedgerEntry[],
    tasks: Task[],
    mintRuntimeId: (task: Task) => string,
    reading: Reading,
): MatchResult {
    const fingerprints = new Map<Task, Fingerprint>();
    for (const task of tasks) {
        fingerprints.set(task, fingerprintOf(task));
    }

    // File order is the only order the matcher trusts on the current side;
    // `ordinal` and the zip in the ladder both read it.
    const ordered = [...tasks].sort((a, b) => a.line - b.line);
    const tree = buildCurrentTree(tasks, ordered);

    const byRuntimeId = new Map(previous.map(entry => [entry.runtimeId, entry]));
    const views: View[] = [];
    for (const state of reading.states) {
        if (!reproduces(state, ordered, byRuntimeId)) continue;
        const names = new Map<Task, string>();
        ordered.forEach((task, i) => names.set(task, state.rows[i].runtimeId));
        views.push({ names, guessed: new Map() });
    }
    // A state whose content was read but whose rows were not (a parser that
    // reads the lines otherwise now) tells nothing, and the ladder answers.
    if (reading.after || views.length === 0) {
        views.push(pairByLadder(ordered, tree, fingerprints, reading.partner));
    }

    const runtimeIdOf = new Map<Task, string>();
    const guessed = new Map<string, number>();
    const disputed = new Set<string>();
    if (views.length === 1) {
        const [only] = views;
        for (const [task, name] of only.names) runtimeIdOf.set(task, name);
        for (const [name, among] of only.guessed) guessed.set(name, among);
    } else {
        const placed = views.map(view => {
            const at = new Map<string, Task>();
            for (const [task, name] of view.names) at.set(name, task);
            return at;
        });
        for (const task of ordered) {
            const said = views.map(view => view.names.get(task)).filter((name): name is string => name !== undefined);
            const name = said[0];
            const agreed = name !== undefined
                && said.every(other => other === name)
                && placed.every(at => { const there = at.get(name); return there === undefined || there === task; });
            for (const other of said) if (!agreed || other !== name) disputed.add(other);
            if (!agreed) continue;
            runtimeIdOf.set(task, name);
        }
        // What position decided in any reading is a guess, whichever is true.
        for (const view of views) {
            for (const [name, among] of view.guessed) guessed.set(name, Math.max(guessed.get(name) ?? 0, among));
        }
        for (const task of ordered) {
            const name = runtimeIdOf.get(task);
            if (name !== undefined) disputed.delete(name);
        }
    }

    const minted: string[] = [];
    for (const task of ordered) {
        let name = runtimeIdOf.get(task);
        if (name === undefined) {
            name = mintRuntimeId(task);
            runtimeIdOf.set(task, name);
        }
        if (!byRuntimeId.has(name)) minted.push(name);
    }
    const kept = new Set(runtimeIdOf.values());

    const mapping = new Map<string, string>();
    for (const task of ordered) {
        mapping.set(task.id, runtimeIdOf.get(task)!);
    }

    return {
        mapping,
        entries: rowsOfTree(ordered, tree, task => runtimeIdOf.get(task)!, task => fingerprints.get(task)!),
        minted,
        retired: previous.filter(entry => !kept.has(entry.runtimeId)).map(entry => entry.runtimeId),
        guessed,
        disputed,
    };
}

/** One reading of the lines: the name it gives each row it names, and which of those position decided. */
interface View {
    names: Map<Task, string>;
    guessed: Map<string, number>;
}

/**
 * The ladder's reading of the lines against `partner`: the two passes, then
 * the check that no pair's evidence is contradicted. Rows it finds no
 * evidence for are left unnamed.
 *
 * A pair (E, T) is taken apart when E or T and some other row R are joined
 * by stronger words than the pair's, or by the pair's own words and a place
 * the pair does not have — unless R's own pair accounts for it. Both rows
 * of a pair taken apart are new. Which of the two is right is not in the
 * lines: a row cut off from its parent reads the same as a row typed
 * elsewhere in its words, and a row indented by hand as one moved away with
 * another typed where it sat.
 *
 * A pair taken apart takes its children's scope with it: the ladder runs
 * again, and the rows below them are paired afresh by the rest of the
 * file. Its two rows are still candidates in that run, and take what the
 * ladder gives them, so no other pair is decided for their being gone;
 * only their pair is not made. That run is checked the same way, until
 * nothing is taken apart. Rows taken apart only grow, so it ends.
 */
function pairByLadder(
    ordered: Task[],
    tree: ReturnType<typeof buildCurrentTree>,
    fingerprints: Map<Task, Fingerprint>,
    partner: readonly LedgerEntry[],
): View {
    const evidence = evidenceBetween(partner, ordered, tree, fingerprints);
    const barred = new Set<LedgerEntry | Task>();
    for (;;) {
        const { pairedWith, guessed } = ladderOnce(ordered, tree, fingerprints, partner, barred);
        const contradicted = evidence.contradicted(pairedWith);
        if (contradicted.length === 0) {
            const names = new Map<Task, string>();
            for (const [task, entry] of pairedWith) names.set(task, entry.runtimeId);
            return { names, guessed };
        }
        for (const [entry, task] of contradicted) {
            barred.add(entry);
            barred.add(task);
        }
    }
}

/** The two passes of the ladder over the rows not `barred`. */
function ladderOnce(
    ordered: Task[],
    tree: ReturnType<typeof buildCurrentTree>,
    fingerprints: Map<Task, Fingerprint>,
    partner: readonly LedgerEntry[],
    barred: ReadonlySet<LedgerEntry | Task>,
): { pairedWith: Map<Task, LedgerEntry>; guessed: Map<string, number> } {
    const { roots, childrenOf } = tree;
    const pairedWith = new Map<Task, LedgerEntry>();
    const matchedPrev = new Set<string>();
    const guessed = new Map<string, number>();
    // Current lines a position-decided bucket held, across both passes.
    const leftByPosition = new Map<Task, number>();
    // A barred row is still a candidate: it takes whatever the ladder would
    // give it, so no other pair is decided for its being gone. Only the pair
    // is not made, and it opens no scope.
    const spent = new Set<Task>();

    const { prevRoots, prevChildren } = buildPreviousTree(partner);

    // --- 1st pass: scope by scope, from the roots down ---
    // `among` is carried down from a parent pair position decided.
    const scopes: Array<{ prev: LedgerEntry[]; cur: Task[]; among?: number }> = [{ prev: prevRoots, cur: roots }];
    while (scopes.length > 0) {
        const scope = scopes.pop()!;
        const { pairs, byPosition } = runLadder(
            scope.prev
                .filter(entry => !matchedPrev.has(entry.runtimeId))
                .map(entry => ({ item: entry, fingerprint: entry.fingerprint })),
            scope.cur
                .filter(task => !pairedWith.has(task) && !spent.has(task))
                .map(task => ({ item: task, fingerprint: fingerprints.get(task)! })),
            leftByPosition,
        );
        for (const [entry, among] of byPosition) guessed.set(entry.runtimeId, among);
        for (const [entry, task] of pairs) {
            matchedPrev.add(entry.runtimeId);
            if (barred.has(entry) || barred.has(task)) {
                spent.add(task);
                continue;
            }
            if (scope.among !== undefined && !guessed.has(entry.runtimeId)) guessed.set(entry.runtimeId, scope.among);
            pairedWith.set(task, entry);
            // Only a matched parent opens its children's scope. An unmatched one
            // takes its whole subtree to the 2nd pass instead of renumbering it.
            scopes.push({
                prev: prevChildren.get(entry.runtimeId) ?? [],
                cur: childrenOf.get(task) ?? [],
                among: guessed.get(entry.runtimeId),
            });
        }
    }

    // --- 2nd pass: the leftovers of the whole file, no scoping ---
    const rescued = runLadder(
        partner
            .filter(entry => !matchedPrev.has(entry.runtimeId))
            .map(entry => ({ item: entry, fingerprint: entry.fingerprint })),
        ordered
            .filter(task => !pairedWith.has(task) && !spent.has(task))
            .map(task => ({ item: task, fingerprint: fingerprints.get(task)! })),
        leftByPosition,
    );
    for (const [entry, task] of rescued.pairs) {
        if (!barred.has(entry) && !barred.has(task)) pairedWith.set(task, entry);
    }
    for (const [entry, among] of rescued.byPosition) guessed.set(entry.runtimeId, among);

    return { pairedWith, guessed };
}

/**
 * How strongly the words of a previous and a current row say they are one
 * row, weakest first. The rungs of the ladder, except that the text is
 * compared up to its indentation: the indentation is where the row sits,
 * which is weighed as place.
 */
const Words = {
    None: 0,
    /** The content or the dates (rung 4). */
    ContentOrDates: 1,
    /** The content and the dates (rung 3). */
    ContentAndDates: 2,
    /** The text up to its indentation (rung 2). */
    Text: 3,
    /** A `^id` that names one row on each side (rung 1). */
    BlockId: 4,
} as const;
type Words = (typeof Words)[keyof typeof Words];

/** What says a previous and a current row are one row. */
interface Relation {
    words: Words;
    /** Their parents are a pair, or both are roots. */
    scope: boolean;
    /** The rows before them are a pair, or both come first. */
    place: boolean;
    /** The line reads the same, indentation and all. */
    depth: boolean;
}

/**
 * Whether `other` says something `pair` does not: stronger words, or the
 * same text and a place the pair lacks. Place counts only between rows of
 * the same text: the ladder never names a row by place, and uses it only to
 * choose among rows the words allow.
 */
function contradicts(other: Relation, pair: Relation): boolean {
    if (other.words !== pair.words) return other.words > pair.words;
    return other.words === Words.Text
        && ((other.scope && !pair.scope) || (other.place && !pair.place) || (other.depth && !pair.depth));
}

/** The evidence between the rows of the two sides, and the check of a ladder's pairs against it. */
function evidenceBetween(
    partner: readonly LedgerEntry[],
    ordered: readonly Task[],
    tree: ReturnType<typeof buildCurrentTree>,
    fingerprints: Map<Task, Fingerprint>,
): { contradicted: (pairedWith: ReadonlyMap<Task, LedgerEntry>) => Array<[LedgerEntry, Task]> } {
    const byRuntimeId = new Map(partner.map(entry => [entry.runtimeId, entry]));
    const parentOfEntry = (entry: LedgerEntry): LedgerEntry | null => {
        const parent = entry.parent === null ? undefined : byRuntimeId.get(entry.parent);
        return parent === undefined || parent === entry ? null : parent;
    };
    const parentOfTask = (task: Task): Task | null => tree.parentOf.get(task) ?? null;
    const previousOrder = [...partner].sort((a, b) => a.line - b.line);
    const entryBefore = new Map<LedgerEntry, LedgerEntry | null>(
        previousOrder.map((entry, index) => [entry, index > 0 ? previousOrder[index - 1] : null]));
    const taskBefore = new Map<Task, Task | null>(
        ordered.map((task, index) => [task, index > 0 ? ordered[index - 1] : null]));

    const count = (keys: Array<string | null>): Map<string, number> => {
        const counted = new Map<string, number>();
        for (const key of keys) if (key !== null) counted.set(key, (counted.get(key) ?? 0) + 1);
        return counted;
    };
    const previousIds = count(partner.map(entry => blockIdKey(entry.fingerprint)));
    const currentIds = count(ordered.map(task => blockIdKey(fingerprints.get(task)!)));

    // Each row's keys, worked out once: the check asks for them of every
    // row it weighs, in every run.
    interface Keys { id: string | null; text: string; contentDate: string; parserId: string; contentKey: string; dateKey: string }
    const keysOf = (fingerprint: Fingerprint): Keys => ({
        id: blockIdKey(fingerprint),
        text: textKey(fingerprint),
        contentDate: contentDateKey(fingerprint),
        parserId: fingerprint.parserId,
        contentKey: fingerprint.contentKey,
        dateKey: fingerprint.dateKey,
    });
    const entryKeys = new Map(partner.map(entry => [entry, keysOf(entry.fingerprint)]));
    const taskKeys = new Map(ordered.map(task => [task, keysOf(fingerprints.get(task)!)]));

    const wordsOf = (entry: LedgerEntry, task: Task): Words => {
        const left = entryKeys.get(entry)!;
        const right = taskKeys.get(task)!;
        if (left.parserId !== right.parserId) return Words.None;
        if (left.id !== null && left.id === right.id && previousIds.get(left.id) === 1 && currentIds.get(left.id) === 1) return Words.BlockId;
        if (left.text === right.text) return Words.Text;
        if (left.contentDate === right.contentDate) return Words.ContentAndDates;
        if (left.contentKey === right.contentKey || left.dateKey === right.dateKey) return Words.ContentOrDates;
        return Words.None;
    };

    // The rows of the other side that share one kind of key with a row.
    type Kind = 'id' | 'text' | 'contentDate';
    const index = <T>(rows: readonly T[], keysOfRow: (row: T) => Keys): Record<Kind, Map<string, T[]>> => {
        const by: Record<Kind, Map<string, T[]>> = { id: new Map(), text: new Map(), contentDate: new Map() };
        for (const row of rows) {
            const keys = keysOfRow(row);
            for (const kind of ['id', 'text', 'contentDate'] as const) {
                const key = keys[kind];
                if (key === null) continue;
                const list = by[kind].get(key);
                if (list) list.push(row);
                else by[kind].set(key, [row]);
            }
        }
        return by;
    };
    const tasksBy = index(ordered, task => taskKeys.get(task)!);
    const entriesBy = index(partner, entry => entryKeys.get(entry)!);
    /**
     * The rows that can say something `pair` does not: those sharing a key
     * of stronger words than the pair's, and, where the pair lacks a place,
     * those of its own text. Content or dates alone never outweigh a pair,
     * which has at least that.
     */
    const against = <T>(keys: Keys, pair: Relation, by: Record<Kind, Map<string, T[]>>): T[][] => {
        const lists: T[][] = [];
        const add = (kind: Kind): void => {
            const key = keys[kind];
            const list = key === null ? undefined : by[kind].get(key);
            if (list) lists.push(list);
        };
        if (pair.words < Words.BlockId) add('id');
        if (pair.words < Words.Text || (pair.words === Words.Text && !(pair.scope && pair.place && pair.depth))) add('text');
        if (pair.words < Words.ContentAndDates) add('contentDate');
        return lists;
    };

    return {
        contradicted: pairedWith => {
            const taskOf = new Map<LedgerEntry, Task>();
            for (const [task, entry] of pairedWith) taskOf.set(entry, task);
            const relation = (entry: LedgerEntry, task: Task): Relation => {
                const entryParent = parentOfEntry(entry);
                const taskParent = parentOfTask(task);
                const entryPrior = entryBefore.get(entry) ?? null;
                const taskPrior = taskBefore.get(task) ?? null;
                return {
                    words: wordsOf(entry, task),
                    scope: entryParent === null
                        ? taskParent === null
                        : taskParent !== null && pairedWith.get(taskParent) === entryParent,
                    place: entryPrior === null
                        ? taskPrior === null
                        : taskPrior !== null && pairedWith.get(taskPrior) === entryPrior,
                    depth: entry.fingerprint.originalText === fingerprints.get(task)!.originalText,
                };
            };

            const contradictedTasks = new Set<Task>();
            for (const [task, entry] of pairedWith) {
                const pair = relation(entry, task);
                const byCurrent = against(entryKeys.get(entry)!, pair, tasksBy).some(list => list.some(other => {
                    if (other === task) return false;
                    const said = relation(entry, other);
                    if (!contradicts(said, pair)) return false;
                    const own = pairedWith.get(other);
                    return own === undefined || contradicts(said, relation(own, other));
                }));
                const byPrevious = byCurrent || against(taskKeys.get(task)!, pair, entriesBy).some(list => list.some(other => {
                    if (other === entry) return false;
                    const said = relation(other, task);
                    if (!contradicts(said, pair)) return false;
                    const own = taskOf.get(other);
                    return own === undefined || contradicts(said, relation(other, own));
                }));
                if (byPrevious) contradictedTasks.add(task);
            }

            // A pair whose scope a contradicted pair opened is left to the next
            // run, where it has no scope and is paired afresh.
            const contradicted: Array<[LedgerEntry, Task]> = [];
            for (const task of contradictedTasks) {
                let below = task;
                let opened = false;
                for (;;) {
                    const parent = parentOfTask(below);
                    const entryParent = parentOfEntry(pairedWith.get(below)!);
                    if (parent === null || entryParent === null || pairedWith.get(parent) !== entryParent) break;
                    if (contradictedTasks.has(parent)) {
                        opened = true;
                        break;
                    }
                    below = parent;
                }
                if (!opened) contradicted.push([pairedWith.get(task)!, task]);
            }
            return contradicted;
        },
    };
}


/**
 * A file's rows as the ladder reads its previous side: each task under the
 * name it is given, with its parent, its ordinal and its fingerprint, in file
 * order.
 *
 * The one definition of that shape. A scan builds the ledger with it, and a
 * write builds the record of what it left with it (`WriteClaims`), so the two
 * cannot read the same lines into different previous sides — a ladder paired
 * against a write's record has to see exactly what it would have seen had a
 * scan read those lines.
 */
export function ledgerRowsOf(tasks: Task[], runtimeIdOf: (task: Task) => string): LedgerEntry[] {
    const ordered = [...tasks].sort((a, b) => a.line - b.line);
    return rowsOfTree(ordered, buildCurrentTree(tasks, ordered), runtimeIdOf, fingerprintOf);
}

function rowsOfTree(
    ordered: Task[],
    tree: ReturnType<typeof buildCurrentTree>,
    runtimeIdOf: (task: Task) => string,
    fingerprintOfTask: (task: Task) => Fingerprint,
): LedgerEntry[] {
    const ordinals = buildOrdinals(tree.roots, tree.childrenOf);
    return ordered.map(task => {
        const parent = tree.parentOf.get(task);
        return {
            runtimeId: runtimeIdOf(task),
            file: task.file,
            parent: parent ? runtimeIdOf(parent) : null,
            ordinal: ordinals.get(task) ?? 0,
            line: task.line,
            fingerprint: fingerprintOfTask(task),
        };
    });
}


interface Rung<T> {
    item: T;
    fingerprint: Fingerprint;
}

interface LadderResult<P, C> {
    pairs: Array<[P, C]>;
    /** Previous rows of the buckets position decided, with the size of their bucket. */
    byPosition: Array<[P, number]>;
    prevLeft: P[];
    curLeft: C[];
}

/**
 * The ladder: strongest evidence first, and never across parsers.
 *
 * 1. `blockId`, and only when it names exactly one row on each side — a `^id`
 *    the user duplicated proves nothing.
 * 2. `originalText` verbatim.
 * 3. content + date tokens, which survives a reformat that left the text alone.
 * 4. one-against-one leftovers that still share either the text or the dates.
 *    Editing the text *or* the dates keeps the ID; editing both is a new task —
 *    the documented price of "when in doubt, mint".
 *
 * Rungs 2 and 3 bucket by key and pair the two sides by nearest ordinal
 * (`pairByOrdinal`), so an n-against-m bucket resolves to min(n, m) pairs
 * instead of guessing.
 *
 * Every rung decides on the rows handed in. What the rest of the file says
 * against a pair is weighed once the passes are done (see `pairByLadder`).
 */
function runLadder<P, C>(
    prev: Array<Rung<P>>,
    cur: Array<Rung<C>>,
    /**
     * Current items a position-decided bucket held, with its size. Filled here
     * and read here, and shared across calls, so a line left over by position
     * in one pass carries that into whatever pairs it later.
     */
    byPositionCur: Map<C, number>,
): LadderResult<P, C> {
    const pairs: Array<[P, C]> = [];
    const byPosition: Array<[P, number]> = [];
    const takenPrev = new Set<number>();
    const takenCur = new Set<number>();
    // A line an earlier bucket left over by position hands that on to the row
    // it is paired with now.
    const inherit = (p: number, c: number): void => {
        const among = byPositionCur.get(cur[c].item);
        if (among !== undefined) byPosition.push([prev[p].item, among]);
    };

    const zip = (keyOf: (fingerprint: Fingerprint) => string | null, oneToOneOnly: boolean): void => {
        const prevBuckets = bucket(prev, takenPrev, keyOf);
        const curBuckets = bucket(cur, takenCur, keyOf);

        for (const [key, curIndexes] of curBuckets) {
            const prevIndexes = prevBuckets.get(key);
            if (!prevIndexes) continue;
            if (oneToOneOnly && (prevIndexes.length !== 1 || curIndexes.length !== 1)) continue;

            // One against one is decided by the key. Anything larger is
            // decided by nearest ordinal, which is position.
            const among = Math.max(prevIndexes.length, curIndexes.length);
            if (among > 1) {
                for (const p of prevIndexes) byPosition.push([prev[p].item, among]);
            }
            for (const [p, c] of pairByOrdinal(prevIndexes, curIndexes)) {
                takenPrev.add(p);
                takenCur.add(c);
                pairs.push([prev[p].item, cur[c].item]);
                inherit(p, c);
            }
            if (among > 1) {
                for (const c of curIndexes) byPositionCur.set(cur[c].item, among);
            }
        }
    };

    zip(blockIdKey, true);
    zip(originalTextKey, false);
    zip(contentDateKey, false);

    const prevRest = remaining(prev, takenPrev);
    const curRest = remaining(cur, takenCur);
    if (prevRest.length === 1 && curRest.length === 1) {
        const left = prev[prevRest[0]].fingerprint;
        const right = cur[curRest[0]].fingerprint;
        const sharesSomething = left.contentKey === right.contentKey || left.dateKey === right.dateKey;
        if (left.parserId === right.parserId && sharesSomething) {
            takenPrev.add(prevRest[0]);
            takenCur.add(curRest[0]);
            pairs.push([prev[prevRest[0]].item, cur[curRest[0]].item]);
            inherit(prevRest[0], curRest[0]);
        }
    }

    return {
        pairs,
        byPosition,
        prevLeft: remaining(prev, takenPrev).map(index => prev[index].item),
        curLeft: remaining(cur, takenCur).map(index => cur[index].item),
    };
}

/** Past this many candidate pairs a bucket is zipped instead of searched. */
const NEAREST_PAIR_LIMIT = 1_000_000;

/**
 * Pair a bucket's two sides by nearest ordinal. Indexes are positions in the
 * lists handed to the ladder — the ordinal within the scope on the 1st pass, file
 * order within the leftover pool on the 2nd — and each side comes in ascending.
 *
 * Equal sizes zip in order, which on a contiguous run is the nearest pairing
 * anyway. Unequal sizes are where a zip goes wrong: checking the third of four
 * identical lines leaves "[ ]" three against four, and a zip slides the fourth
 * line onto the third's ID. There, pairs are taken greedily by the smallest
 * ordinal gap, ties to the smaller previous then current ordinal, so the answer
 * is deterministic.
 */
function pairByOrdinal(prevIndexes: number[], curIndexes: number[]): Array<[number, number]> {
    const count = Math.min(prevIndexes.length, curIndexes.length);
    if (prevIndexes.length === curIndexes.length
        || prevIndexes.length * curIndexes.length > NEAREST_PAIR_LIMIT) {
        return prevIndexes.slice(0, count).map((p, i): [number, number] => [p, curIndexes[i]]);
    }

    const candidates: Array<[number, number]> = [];
    for (const p of prevIndexes) {
        for (const c of curIndexes) candidates.push([p, c]);
    }
    candidates.sort((a, b) => Math.abs(a[0] - a[1]) - Math.abs(b[0] - b[1]) || a[0] - b[0] || a[1] - b[1]);

    const usedPrev = new Set<number>();
    const usedCur = new Set<number>();
    const result: Array<[number, number]> = [];
    for (const [p, c] of candidates) {
        if (usedPrev.has(p) || usedCur.has(c)) continue;
        usedPrev.add(p);
        usedCur.add(c);
        result.push([p, c]);
        if (result.length === count) break;
    }
    return result;
}

function bucket<T>(
    rungs: Array<Rung<T>>,
    taken: Set<number>,
    keyOf: (fingerprint: Fingerprint) => string | null
): Map<string, number[]> {
    const buckets = new Map<string, number[]>();
    for (let i = 0; i < rungs.length; i++) {
        if (taken.has(i)) continue;
        const key = keyOf(rungs[i].fingerprint);
        if (key === null) continue;
        const list = buckets.get(key);
        if (list) list.push(i);
        else buckets.set(key, [i]);
    }
    return buckets;
}

function remaining<T>(rungs: Array<Rung<T>>, taken: Set<number>): number[] {
    const result: number[] = [];
    for (let i = 0; i < rungs.length; i++) {
        if (!taken.has(i)) result.push(i);
    }
    return result;
}

// Keys are JSON arrays, so no separator can be forged out of a task's own text.
// `parserId` leads every one of them: turning a third-party notation on or off
// renumbers its tasks — the same deal as any settings change — but a Tasks-plugin
// line must never inherit a tv-inline line's ID.
function blockIdKey(fingerprint: Fingerprint): string | null {
    return fingerprint.blockId ? JSON.stringify([fingerprint.parserId, fingerprint.blockId]) : null;
}

function originalTextKey(fingerprint: Fingerprint): string {
    return JSON.stringify([fingerprint.parserId, fingerprint.originalText]);
}

/** The text up to its indentation. */
function textKey(fingerprint: Fingerprint): string {
    return JSON.stringify([fingerprint.parserId, fingerprint.originalText.trimStart()]);
}

function contentDateKey(fingerprint: Fingerprint): string {
    return JSON.stringify([fingerprint.parserId, fingerprint.contentKey, fingerprint.dateKey]);
}

function buildCurrentTree(tasks: Task[], ordered: Task[]) {
    const byId = new Map<string, Task>();
    for (const task of tasks) {
        if (!byId.has(task.id)) byId.set(task.id, task);
    }

    // `parentId` is the edge the extractor writes; `childIds` only fills gaps, so
    // a half-wired pair still lands in the right scope instead of at the root.
    const parentOf = new Map<Task, Task>();
    for (const task of tasks) {
        const parent = task.parentId ? byId.get(task.parentId) : undefined;
        if (parent && parent !== task) parentOf.set(task, parent);
    }
    for (const task of tasks) {
        for (const childId of task.childIds) {
            const child = byId.get(childId);
            if (child && child !== task && !parentOf.has(child)) parentOf.set(child, task);
        }
    }

    const roots: Task[] = [];
    const childrenOf = new Map<Task, Task[]>();
    for (const task of ordered) {
        const parent = parentOf.get(task);
        if (!parent) {
            roots.push(task);
            continue;
        }
        const siblings = childrenOf.get(parent);
        if (siblings) siblings.push(task);
        else childrenOf.set(parent, [task]);
    }

    return { parentOf, roots, childrenOf };
}

function buildPreviousTree(previous: readonly LedgerEntry[]) {
    const known = new Set(previous.map(entry => entry.runtimeId));

    const prevRoots: LedgerEntry[] = [];
    const prevChildren = new Map<string, LedgerEntry[]>();
    for (const entry of previous) {
        const parent = entry.parent;
        if (parent === null || parent === entry.runtimeId || !known.has(parent)) {
            prevRoots.push(entry);
            continue;
        }
        const siblings = prevChildren.get(parent);
        if (siblings) siblings.push(entry);
        else prevChildren.set(parent, [entry]);
    }

    return { prevRoots, prevChildren };
}

function buildOrdinals(roots: Task[], childrenOf: Map<Task, Task[]>): Map<Task, number> {
    const ordinals = new Map<Task, number>();
    roots.forEach((task, index) => ordinals.set(task, index));
    for (const siblings of childrenOf.values()) {
        siblings.forEach((task, index) => ordinals.set(task, index));
    }
    return ordinals;
}

export interface GuardedMatch {
    result: MatchResult;
    /** Whether the known states were thrown out and the file matched again without them. */
    withoutClaims: boolean;
}

/**
 * Match, and if the answer would give one runtime ID to two rows, match again
 * with no known state at all.
 *
 * A duplicate is the one answer that does lasting damage. The store is keyed by
 * ID, so the second row overwrites the first and the file comes out a task
 * short of its lines; the ledger keeps both positions and one entry, and since
 * that ledger is what the next scan compares against, the state is stable and
 * wrong. The task whose ID went missing then refuses every write as "not
 * found" while its line sits there in plain sight. Nothing recovers it.
 *
 * So the answer is checked before it is used, and the fallback is the ladder on
 * its own: it takes each previous row at most once, which is the property that
 * makes a duplicate impossible. What that costs is the precision of one scan.
 *
 * Only a known state can bring this about (a record whose rows repeat a name
 * is refused by `reproduces`, and readings that disagree keep no name twice),
 * which is why matching again without them is the whole remedy — and why the second run is not checked again here. A
 * dev-build assertion at the store's threshold covers the case where the ladder
 * itself learns to repeat an ID.
 */
export function matchWithoutRepeatedIds(
    run: (reading: Reading) => MatchResult,
    reading: Reading,
): GuardedMatch {
    const result = run(reading);
    if (reading.states.length === 0 || !repeatsAnId(result.entries)) {
        return { result, withoutClaims: false };
    }
    return { result: run({ states: [], after: true, partner: reading.partner }), withoutClaims: true };
}

function repeatsAnId(entries: readonly LedgerEntry[]): boolean {
    const seen = new Set<string>();
    for (const entry of entries) {
        if (seen.has(entry.runtimeId)) return true;
        seen.add(entry.runtimeId);
    }
    return false;
}
