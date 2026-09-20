import { describe, it, expect } from 'vitest';
import { matchFile } from '../../../../../src/services/core/identity/IdentityMatcher';
import type { Hint, PendingHint } from '../../../../../src/services/core/identity/IdentityHints';
import { makeTask } from '../../../helpers/makeTask';
import type { Task } from '../../../../../src/types';

/**
 * Every short sequence of writes over a small file, checked against the truth
 * the test itself kept.
 *
 * Hand-picked cases pinned the shapes someone thought of; two of them were
 * missed that way. Here a tiny model of the write layer applies each sequence
 * to a file *and* records which row each resulting line really belongs to, so
 * the assertion is not "the answer looks right" but "the answer is what the
 * writes actually did".
 *
 * The invariant is one-sided on purpose. A believed hint must never contradict
 * the truth; a hint the matcher declines to believe is free to fall to the
 * ladder, which may then mint. Precision is optional, correctness is not.
 */

const FILE = 'sweep.md';

/** A line of the modelled file, with the row it belongs to. */
interface ModelLine {
    /** The runtime ID this line carries, or null once a write created it. */
    owner: string | null;
    text: string;
}

interface Operation {
    name: string;
    /** Applies to the model, answering the hint the writer would raise. */
    apply: (lines: ModelLine[]) => Hint | null;
}

const TEXTS = ['- [ ] 同じ本文', '- [ ] 別の本文', '- [ ] 三つ目'];

/** Rewrite row `index`'s line to a text the file may already hold elsewhere. */
function rewriteTo(index: number, text: string): Operation {
    return {
        name: `rewrite#${index}→${text}`,
        apply: (lines) => {
            const row = lines[index];
            if (!row || row.owner === null || row.text === text) return null;
            const hint: Hint = {
                kind: 'rewrite', runtimeId: row.owner, before: row.text, after: text,
            };
            row.text = text;
            return hint;
        },
    };
}

/** Duplicate row `index`, placing the copy on `side` of it. */
function duplicate(index: number, side: 'before' | 'after'): Operation {
    return {
        name: `duplicate#${index}/${side}`,
        apply: (lines) => {
            const row = lines[index];
            if (!row || row.owner === null) return null;
            const hint: Hint = {
                kind: 'insert', text: row.text, anchor: row.owner, side,
            };
            lines.splice(side === 'before' ? index : index + 1, 0, { owner: null, text: row.text });
            return hint;
        },
    };
}

/** Delete row `index`. */
function remove(index: number): Operation {
    return {
        name: `delete#${index}`,
        apply: (lines) => {
            const row = lines[index];
            if (!row || row.owner === null) return null;
            const hint: Hint = { kind: 'retire', runtimeId: row.owner };
            lines.splice(index, 1);
            return hint;
        },
    };
}

const OPERATIONS: Operation[] = [
    rewriteTo(0, TEXTS[1]),
    rewriteTo(1, TEXTS[0]),
    rewriteTo(0, TEXTS[2]),
    duplicate(0, 'before'),
    duplicate(0, 'after'),
    duplicate(1, 'before'),
    remove(0),
    remove(1),
];

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

/** Run one sequence and answer what the matcher decided, plus the truth. */
function run(sequence: Operation[]) {
    const mint = makeMint();
    const startTexts = [TEXTS[0], TEXTS[0], TEXTS[1]];
    const first = matchFile([], toTasks(startTexts.map(text => ({ owner: null, text }))), mint);

    // The truth: every starting line owned by the row the first scan gave it.
    const model: ModelLine[] = first.entries.map(entry => ({
        owner: entry.runtimeId,
        text: entry.fingerprint.originalText,
    }));

    const hints: PendingHint[] = [];
    for (const operation of sequence) {
        const hint = operation.apply(model);
        if (hint === null) return null;
        hints.push({ seq: hints.length + 1, at: 0, hint });
    }
    if (model.length === 0) return null;

    const tasks = toTasks(model);
    const result = matchFile(first.entries, tasks, mint, hints);
    return { model, tasks, result, before: first };
}

function pairs(sequence: Operation[]): string {
    return sequence.map(operation => operation.name).join(' → ');
}

describe('every short write sequence, against the truth', () => {
    const sequences: Operation[][] = [];
    for (const a of OPERATIONS) {
        sequences.push([a]);
        for (const b of OPERATIONS) {
            sequences.push([a, b]);
            for (const c of OPERATIONS) sequences.push([a, b, c]);
        }
    }

    it(`never contradicts what the writes did (${sequences.length} sequences)`, () => {
        let believed = 0;

        for (const sequence of sequences) {
            const outcome = run(sequence);
            if (!outcome) continue;

            const { model, tasks, result, before } = outcome;
            const label = pairs(sequence);

            for (let i = 0; i < model.length; i++) {
                const decided = result.mapping.get(tasks[i].id);
                const truth = model[i].owner;

                if (truth === null) {
                    // A line the writes created must never take a row that
                    // existed before them.
                    const previousIds = new Set(before.entries.map(entry => entry.runtimeId));
                    expect(previousIds.has(decided!), `${label} line ${i} took an old ID`).toBe(false);
                    continue;
                }

                // A line that survived may keep its row or be renumbered (the
                // ladder's privilege), but it must never carry another row's.
                if (decided !== truth) {
                    expect(before.entries.some(entry => entry.runtimeId === decided),
                        `${label} line ${i} took row ${decided}, truth ${truth}`).toBe(false);
                }
            }

            // A row the writes deleted must not resurface on any line.
            const alive = new Set(model.map(line => line.owner).filter(Boolean));
            for (const entry of before.entries) {
                if (alive.has(entry.runtimeId)) continue;
                expect([...result.mapping.values()].includes(entry.runtimeId),
                    `${label} resurrected ${entry.runtimeId}`).toBe(false);
            }

            if (result.consumedHints > 0) believed++;
        }

        // The sweep is only meaningful if the hints are actually being used;
        // a change that quietly stopped believing them would otherwise pass.
        expect(believed).toBeGreaterThan(sequences.length / 4);
    });
});
