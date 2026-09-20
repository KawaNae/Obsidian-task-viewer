import { describe, it, expect } from 'vitest';
import { WriteClaims, type ClaimBase } from '../../../../../src/services/core/identity/WriteClaims';
import { FileParsePipeline } from '../../../../../src/services/parsing/FileParsePipeline';
import { DEFAULT_SETTINGS } from '../../../../../src/types';
import type { LineEdit } from '../../../../../src/utils/FileLines';

/**
 * What a write reports about lines, turned into what the next scan is told
 * about rows.
 *
 * The parse is the real one. That is the point of this layer: a writer knows
 * which lines it touched and cannot know which of them are tasks — a copied
 * child may be a note, a property line, or three lines of a fenced block — and
 * the parser is the only thing that answers.
 */

const FILE = 'note.md';

/** The real pipeline, as the scanner runs it. */
const parseRows = (path: string, lines: readonly string[]) =>
    FileParsePipeline.parse(path, [...lines], undefined, DEFAULT_SETTINGS)
        .tasks
        .slice()
        .sort((a, b) => a.line - b.line)
        .map(task => ({ line: task.line, text: task.originalText }));

function claimsWith(ledger: ClaimBase[] = []): WriteClaims {
    return new WriteClaims(parseRows, () => ledger);
}

/** A ledger row: the id it carries, the line it was read on, what it read. */
const known = (runtimeId: string, line: number, text: string): ClaimBase =>
    ({ runtimeId, line, text });

const inserted = (at: number, count: number): LineEdit => ({ kind: 'inserted', at, count });
const replaced = (at: number): LineEdit => ({ kind: 'replaced', at });
const removed = (at: number, count: number): LineEdit => ({ kind: 'removed', at, count });

describe('WriteClaims: which lines are rows', () => {
    it('counts only the lines the parser reads as tasks', () => {
        // The duplicate copies a whole block: a task line, a task child, a
        // note, and a fenced block with a task-shaped line inside it. Four of
        // those seven lines are rows; a writer claiming its own rows would have
        // to know which, and would get the fence wrong.
        const before = [
            '- [ ] 親',
            '\t- [ ] 子',
            '\tmemo',
            '\t```js',
            '\t- [ ] これはコード',
            '\t```',
        ];
        const after = [...before, ...before];
        const claims = claimsWith([known('r1', 0, '- [ ] 親'), known('r2', 1, '\t- [ ] 子')]);

        const claim = claims.claim(FILE, before, after, [inserted(6, 6)]);

        expect(claim).not.toBeNull();
        expect(claim!.rows).toEqual([
            { runtimeId: 'r1', text: '- [ ] 親' },
            { runtimeId: 'r2', text: '\t- [ ] 子' },
            { runtimeId: null, text: '- [ ] 親' },
            { runtimeId: null, text: '\t- [ ] 子' },
        ]);
    });

    it('carries an identity through a line that was rewritten', () => {
        const before = ['- [ ] 報告 @2026-09-21'];
        const after = ['- [x] 報告 @2026-09-21'];
        const claims = claimsWith([known('r1', 0, '- [ ] 報告 @2026-09-21')]);

        const claim = claims.claim(FILE, before, after, [replaced(0)]);

        expect(claim!.rows).toEqual([{ runtimeId: 'r1', text: '- [x] 報告 @2026-09-21' }]);
    });

    it('leaves a removed row out', () => {
        const before = ['- [ ] 甲', '- [ ] 乙'];
        const after = ['- [ ] 乙'];
        const claims = claimsWith([known('r1', 0, '- [ ] 甲'), known('r2', 1, '- [ ] 乙')]);

        const claim = claims.claim(FILE, before, after, [removed(0, 1)]);

        expect(claim!.rows).toEqual([{ runtimeId: 'r2', text: '- [ ] 乙' }]);
    });

    it('says the rows are unchanged when a write touched no task line', () => {
        // Worth saying: it agrees with the state before it, so a scan that
        // reads either can adopt it (see resolveHints).
        const before = ['- [ ] 甲', '\tmemo'];
        const after = ['- [ ] 甲', '\tmemo 書き足した'];
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')]);

        const claim = claims.claim(FILE, before, after, [replaced(1)]);

        expect(claim!.rows).toEqual([{ runtimeId: 'r1', text: '- [ ] 甲' }]);
    });
});

describe('WriteClaims: what it builds on', () => {
    it('builds the second write on what the first one left', () => {
        // No scan ran in between, so the ledger still describes the file as it
        // was before the first write. It is not merely out of date: the first
        // write put a copy *above* the known row, so the ledger's line 0 now
        // holds the copy. The ledger still fits — the text there is the same
        // word — and building on it would hand the copy the original's
        // identity, which is the very mistake stage 2 exists to prevent. What
        // the last write left is the only thing that knows better.
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')]);

        const first = claims.claim(FILE, ['- [ ] 甲'], ['- [ ] 甲', '- [ ] 甲'], [inserted(0, 1)]);
        expect(first!.rows.map(row => row.runtimeId)).toEqual([null, 'r1']);

        const second = claims.claim(
            FILE,
            ['- [ ] 甲', '- [ ] 甲'],
            ['- [ ] 甲', '- [ ] 甲', '- [ ] 丙'],
            [inserted(2, 1)],
        );

        expect(second!.rows).toEqual([
            { runtimeId: null, text: '- [ ] 甲' },
            { runtimeId: 'r1', text: '- [ ] 甲' },
            { runtimeId: null, text: '- [ ] 丙' },
        ]);
    });

    it('falls back to the ledger once a scan has spoken', () => {
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')]);
        claims.claim(FILE, ['- [ ] 甲'], ['- [ ] 甲', '- [ ] 乙'], [inserted(1, 1)]);

        // The scan committed: whatever the write thought it left, the ledger is
        // the authority now.
        claims.forget(FILE);

        const next = claims.claim(FILE, ['- [ ] 甲'], ['- [x] 甲'], [replaced(0)]);
        expect(next!.rows).toEqual([{ runtimeId: 'r1', text: '- [x] 甲' }]);
    });

    it('says nothing when the file is not what either base describes', () => {
        // Someone edited the note between the last scan and this write.
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')]);

        const claim = claims.claim(FILE, ['- [ ] 手で書き換えた'], ['- [x] 手で書き換えた'], [replaced(0)]);

        expect(claim).toBeNull();
    });

    it('says nothing when the report does not fit the file it was given', () => {
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')]);

        const claim = claims.claim(FILE, ['- [ ] 甲'], ['- [ ] 甲', '- [ ] 乙'], [removed(5, 1)]);

        expect(claim).toBeNull();
    });

    it('forgets its base when it could not answer', () => {
        // A write it could not follow leaves it with no idea where the rows
        // are; the next write starts from the ledger instead.
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')]);
        claims.claim(FILE, ['- [ ] 甲'], ['- [ ] 甲', '- [ ] 乙'], [inserted(1, 1)]);
        claims.claim(FILE, ['他人の編集'], ['他人の編集'], [replaced(0)]);

        const next = claims.claim(FILE, ['- [ ] 甲'], ['- [x] 甲'], [replaced(0)]);
        expect(next!.rows).toEqual([{ runtimeId: 'r1', text: '- [x] 甲' }]);
    });

    it('claims a file the ledger knows nothing about as all new', () => {
        const claims = claimsWith([]);

        const claim = claims.claim(FILE, [''], ['- [ ] 初めての行'], [replaced(0)]);

        expect(claim!.rows).toEqual([{ runtimeId: null, text: '- [ ] 初めての行' }]);
    });
});
