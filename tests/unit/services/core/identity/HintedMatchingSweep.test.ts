import { describe, it, expect } from 'vitest';
import { matchFile as matchWithEvidence } from '../../../../../src/services/core/identity/IdentityMatcher';
import type { LedgerEntry } from '../../../../../src/services/core/identity/IdentityLedger';
import { rowsOnlyEvidence } from '../../../helpers/rowsOnlyEvidence';
import type { Hint, PendingHint } from '../../../../../src/services/core/identity/IdentityHints';
import { makeTask } from '../../../helpers/makeTask';

/** The matcher, weighing claims about a file made only of its rows (see rowsOnlyEvidence). */
function matchFile(
    previous: LedgerEntry[],
    tasks: Task[],
    mint: (task: Task) => string,
    pending?: readonly PendingHint[],
) {
    return matchWithEvidence(previous, tasks, mint,
        pending ? rowsOnlyEvidence(previous, tasks, pending) : undefined);
}
import type { Task } from '../../../../../src/types';

/**
 * Every short sequence of writes over a small file, read back at every point
 * it passed through, and checked against the truth the test itself kept.
 *
 * Hand-picked cases pin the shapes someone thought of; three were missed that
 * way. Here a tiny model of the write layer applies each sequence to a file
 * *and* records which row each resulting line really belongs to, so the
 * assertion is not "the answer looks right" but "the answer is what the writes
 * actually did".
 *
 * The second axis is which state the scan read. A scan's read does not have to
 * land after the last write: it can return the file as it was two writes ago
 * while all of their claims are already filed. With claims replayed as per-line
 * edits, 52 of those reads were answered wrongly — every one of them a file
 * that came back to a text it already had, where the claims could not all be
 * true at once and one of them was believed anyway. So every intermediate state
 * is read here, with the whole log pending.
 *
 * The invariant is one-sided on purpose. An adopted claim must never contradict
 * the truth; a claim the matcher declines is free to fall to the ladder, which
 * may then mint. Precision is optional, correctness is not.
 */

const FILE = 'sweep.md';

/** A line of the modelled file, with the row it belongs to. */
interface ModelLine {
    /** The runtime ID this line carries. */
    owner: string;
    /** Whether a write of this sequence made it, and named it on the spot. */
    created: boolean;
    text: string;
}

interface Operation {
    name: string;
    /** Applies to the model. False when this write cannot be made here. */
    apply: (lines: ModelLine[]) => boolean;
}

const TEXTS = ['- [ ] 同じ本文', '- [ ] 別の本文', '- [ ] 三つ目'];

/** Rewrite row `index`'s line to a text the file may already hold elsewhere. */
function rewriteTo(index: number, text: string): Operation {
    return {
        name: `rewrite#${index}→${text}`,
        apply: (lines) => {
            const row = lines[index];
            if (!row || row.created || row.text === text) return false;
            row.text = text;
            return true;
        },
    };
}

/**
 * Duplicate row `index`, placing the copy on `side` of it.
 *
 * The copy is named here, by the model's write layer, because that is where
 * the real one names it: the line comes into being inside `vault.process`, and
 * the name it is given there is the one every later claim about it carries.
 */
function duplicate(index: number, side: 'before' | 'after', coin: () => string): Operation {
    return {
        name: `duplicate#${index}/${side}`,
        apply: (lines) => {
            const row = lines[index];
            if (!row || row.created) return false;
            lines.splice(side === 'before' ? index : index + 1, 0,
                { owner: coin(), created: true, text: row.text });
            return true;
        },
    };
}

/** Delete row `index`. */
function remove(index: number): Operation {
    return {
        name: `delete#${index}`,
        apply: (lines) => {
            const row = lines[index];
            if (!row || row.created) return false;
            lines.splice(index, 1);
            return true;
        },
    };
}

/**
 * The operations of one run, with that run's own coiner for the lines its
 * writes make. Per run, so the names a sequence hands out do not depend on
 * which sequences ran before it.
 */
function operations(coin: () => string): Operation[] {
    return [
        rewriteTo(0, TEXTS[1]),
        rewriteTo(1, TEXTS[0]),
        rewriteTo(0, TEXTS[2]),
        duplicate(0, 'before', coin),
        duplicate(0, 'after', coin),
        duplicate(1, 'before', coin),
        remove(0),
        remove(1),
    ];
}

/** Named the way a scan's mint names, so a coined ID is a usable one. */
function makeCoiner() {
    let seq = 0;
    return () => `tv-inline:${FILE}:seq:w${++seq}`;
}

/** The operation *names*, which is all the sequences need to be built from. */
const OPERATION_NAMES = operations(() => '').map(operation => operation.name);

function makeMint() {
    let seq = 0;
    return (task: Task): string => `${task.parserId}:${task.file}:seq:${++seq}`;
}

function toTasks(lines: ModelLine[]): Task[] {
    return lines.map((line, index) => makeTask({
        id: `prov:${index}`,
        file: FILE,
        line: index,
        originalText: line.text,
        content: line.text.replace(/^- \[.\] /, ''),
    }));
}

/** What a write layer that knows the truth would claim: the file's rows. */
function claimOf(lines: ModelLine[]): Hint {
    return {
        rows: lines.map(line => ({
            runtimeId: line.owner,
            created: line.created,
            text: line.text,
        })),
    };
}

interface Run {
    /** The file as it stood after each write, index 0 being before them all. */
    states: ModelLine[][];
    hints: PendingHint[];
    before: ReturnType<typeof matchFile>;
    /** The run's own minter, so a later read cannot re-issue an earlier ID. */
    mint: (task: Task) => string;
}

/** Apply one sequence, keeping every state it passed through. */
function run(names: string[]): Run | null {
    const mint = makeMint();
    const sequence = byName(operations(makeCoiner()), names);
    const startTexts = [TEXTS[0], TEXTS[0], TEXTS[1]];
    const before = matchFile(
        [], toTasks(startTexts.map(text => ({ owner: '', created: false, text }))), mint);

    // The truth: every starting line owned by the row the first scan gave it.
    const model: ModelLine[] = before.entries.map(entry => ({
        owner: entry.runtimeId,
        created: false,
        text: entry.fingerprint.originalText,
    }));

    const states: ModelLine[][] = [model.map(line => ({ ...line }))];
    const hints: PendingHint[] = [];
    for (const operation of sequence) {
        if (!operation.apply(model)) return null;
        hints.push({ seq: hints.length + 1, at: 0, hint: claimOf(model) });
        states.push(model.map(line => ({ ...line })));
    }

    return { states, hints, before, mint };
}

function byName(available: Operation[], names: string[]): Operation[] {
    return names.map(name => available.find(operation => operation.name === name)!);
}

function label(names: string[]): string {
    return names.join(' → ');
}

describe('every short write sequence, read back at every point', () => {
    const sequences: string[][] = [];
    for (const a of OPERATION_NAMES) {
        sequences.push([a]);
        for (const b of OPERATION_NAMES) {
            sequences.push([a, b]);
            for (const c of OPERATION_NAMES) sequences.push([a, b, c]);
        }
    }

    it(`never contradicts what the writes did (${sequences.length} sequences)`, () => {
        let reads = 0;
        let adoptedOnCurrentRead = 0;
        let currentReads = 0;

        for (const sequence of sequences) {
            const outcome = run(sequence);
            if (!outcome) continue;

            const { states, hints, before, mint } = outcome;
            const previousIds = new Set(before.entries.map(entry => entry.runtimeId));
            const name = label(sequence);

            for (let read = 0; read < states.length; read++) {
                const truth = states[read];
                if (truth.length === 0) continue;
                reads++;

                const tasks = toTasks(truth);
                const result = matchFile(before.entries, tasks, mint, hints);
                const where = `${name} @read ${read}`;

                if (read === states.length - 1) {
                    currentReads++;
                    if (result.consumedHints > 0) adoptedOnCurrentRead++;
                }

                // The one-sided part, stated in code: what the ladder decides
                // on its own is outside this sweep. It pairs on evidence rather
                // than knowledge and is wrong here often (a line a write
                // created, worded like no other, still takes the leftover row
                // at the bottom rung) — that is the imprecision rung 0 exists
                // to reduce, not a contradiction to catch.
                if (result.consumedHints === 0) continue;

                for (let i = 0; i < truth.length; i++) {
                    const decided = result.mapping.get(tasks[i].id)!;
                    const owner = truth[i].owner;

                    if (truth[i].created) {
                        // The name the write coined for it, and no other. A
                        // scan minting a second name for a line that already
                        // has one is the whole of what this change fixes.
                        expect(decided, `${where} line ${i} was renamed`).toBe(owner);
                        // A line the writes created must never take a row that
                        // existed before them.
                        expect(previousIds.has(decided), `${where} line ${i} took an old ID`).toBe(false);
                        continue;
                    }

                    // A line that survived may keep its row or be renumbered
                    // (the ladder's privilege), but never carry another row's.
                    if (decided !== owner) {
                        expect(previousIds.has(decided),
                            `${where} line ${i} took row ${decided}, truth ${owner}`).toBe(false);
                    }
                }

                // A row the writes deleted must not resurface on any line.
                const alive = new Set(truth.map(line => line.owner));
                for (const entry of before.entries) {
                    if (alive.has(entry.runtimeId)) continue;
                    expect([...result.mapping.values()].includes(entry.runtimeId),
                        `${where} resurrected ${entry.runtimeId}`).toBe(false);
                }

            }
        }

        // The sweep is only meaningful if the claims are actually being used; a
        // change that quietly stopped adopting them would otherwise pass. The
        // floor is well under what this scores (four in five reads of the
        // current file), so it catches a mechanism that stopped working rather
        // than a rule that traded a little precision for something.
        expect(reads).toBeGreaterThan(800);
        expect(adoptedOnCurrentRead).toBeGreaterThan(currentReads * 3 / 4);
    });
});
