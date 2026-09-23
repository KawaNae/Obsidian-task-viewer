import { describe, it, expect } from 'vitest';
import { WriteClaims, type ClaimBase } from '../../../../../src/services/core/identity/WriteClaims';
import { FileParsePipeline } from '../../../../../src/services/parsing/FileParsePipeline';
import { DEFAULT_SETTINGS } from '../../../../../src/types';
import type { LineEdit } from '../../../../../src/utils/FileLines';
import { contentKeyOf } from '../../../../../src/services/core/identity/ContentKey';

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

/** The real pipeline, as the scanner runs it — same order, same refusal. */
const parseRows = (path: string, lines: readonly string[]) => {
    const parsed = FileParsePipeline.parse(path, [...lines], undefined, DEFAULT_SETTINGS);
    if (parsed.ignored) return null;
    return parsed.tasks;
};

/**
 * The write layer's own minter: a new name every call, and never one back.
 *
 * Per instance, so a test can say which name a write handed out by counting
 * the writes it made — including the ones it withdrew, which spend a name all
 * the same.
 */
function mint() {
    let seq = 0;
    return () => `w${++seq}`;
}

/**
 * What the last scan recorded: its rows, and the key of the lines it read them
 * from — null for a file no scan has committed. The lines default to the rows'
 * own, each on its line, which is the whole file whenever nothing but rows is
 * in it.
 */
function ledgerOf(rows: ClaimBase[], read: readonly string[] | null = linesOf(rows)) {
    return () => ({ rows, content: read === null ? null : contentKeyOf(read) });
}

function linesOf(rows: readonly ClaimBase[]): string[] {
    const lines: string[] = [];
    for (const row of rows) lines[row.line] = row.text;
    // A file always has a line, if an empty one: that is what splitting it gives.
    return lines.length === 0 ? [''] : Array.from(lines, line => line ?? '');
}

function claimsWith(ledger: ClaimBase[] = [], read?: readonly string[] | null): WriteClaims {
    return new WriteClaims(parseRows, ledgerOf(ledger, read), mint());
}

/** A ledger row: the id it carries, the line it was read on, what it read. */
const known = (runtimeId: string, line: number, text: string): ClaimBase =>
    ({ runtimeId, created: false, line, text });

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
        const claims = claimsWith([known('r1', 0, '- [ ] 親'), known('r2', 1, '\t- [ ] 子')], before);

        const claim = claims.claim(FILE, before, after, [inserted(6, 6)]);

        expect(claim.hint).not.toBeNull();
        expect(claim.hint!.rows).toEqual([
            { runtimeId: 'r1', created: false, text: '- [ ] 親' },
            { runtimeId: 'r2', created: false, text: '\t- [ ] 子' },
            { runtimeId: 'w1', created: true, text: '- [ ] 親' },
            { runtimeId: 'w2', created: true, text: '\t- [ ] 子' },
        ]);
    });

    it('carries an identity through a line that was rewritten', () => {
        const before = ['- [ ] 報告 @2026-09-21'];
        const after = ['- [x] 報告 @2026-09-21'];
        const claims = claimsWith([known('r1', 0, '- [ ] 報告 @2026-09-21')]);

        const claim = claims.claim(FILE, before, after, [replaced(0)]);

        expect(claim.hint!.rows).toEqual([{ runtimeId: 'r1', created: false, text: '- [x] 報告 @2026-09-21' }]);
    });

    it('leaves a removed row out', () => {
        const before = ['- [ ] 甲', '- [ ] 乙'];
        const after = ['- [ ] 乙'];
        const claims = claimsWith([known('r1', 0, '- [ ] 甲'), known('r2', 1, '- [ ] 乙')]);

        const claim = claims.claim(FILE, before, after, [removed(0, 1)]);

        expect(claim.hint!.rows).toEqual([{ runtimeId: 'r2', created: false, text: '- [ ] 乙' }]);
    });

    it('says the rows are unchanged when a write touched no task line', () => {
        // Worth saying: it agrees with the state before it, so a scan that
        // reads either can adopt it (see resolveHints).
        const before = ['- [ ] 甲', '\tmemo'];
        const after = ['- [ ] 甲', '\tmemo 書き足した'];
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')], before);

        const claim = claims.claim(FILE, before, after, [replaced(1)]);

        expect(claim.hint!.rows).toEqual([{ runtimeId: 'r1', created: false, text: '- [ ] 甲' }]);
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
        expect(first.hint!.rows.map(row => row.runtimeId)).toEqual(['w1', 'r1']);

        const second = claims.claim(
            FILE,
            ['- [ ] 甲', '- [ ] 甲'],
            ['- [ ] 甲', '- [ ] 甲', '- [ ] 丙'],
            [inserted(2, 1)],
        );

        // The copy keeps the name the first write gave it, and keeps being
        // told as new: no scan has recorded it yet, however many writes have
        // gone over the file since.
        expect(second.hint!.rows).toEqual([
            { runtimeId: 'w1', created: true, text: '- [ ] 甲' },
            { runtimeId: 'r1', created: false, text: '- [ ] 甲' },
            { runtimeId: 'w2', created: true, text: '- [ ] 丙' },
        ]);
    });

    it('falls back to the ledger once a scan has spoken', () => {
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')]);
        claims.claim(FILE, ['- [ ] 甲'], ['- [ ] 甲', '- [ ] 乙'], [inserted(1, 1)]);

        // The scan committed: whatever the write thought it left, the ledger is
        // the authority now.
        claims.forget(FILE);

        const next = claims.claim(FILE, ['- [ ] 甲'], ['- [x] 甲'], [replaced(0)]);
        expect(next.hint!.rows).toEqual([{ runtimeId: 'r1', created: false, text: '- [x] 甲' }]);
    });

    it('says nothing when the file is not what either base describes', () => {
        // Someone edited the note between the last scan and this write.
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')]);

        const claim = claims.claim(FILE, ['- [ ] 手で書き換えた'], ['- [x] 手で書き換えた'], [replaced(0)]);

        expect(claim.hint).toBeNull();
    });

    it('says nothing when the report does not fit the file it was given', () => {
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')]);

        const claim = claims.claim(FILE, ['- [ ] 甲'], ['- [ ] 甲', '- [ ] 乙'], [removed(5, 1)]);

        expect(claim.hint).toBeNull();
    });

    it('stays silent after a write it could not follow, until a scan commits', () => {
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')]);
        claims.claim(FILE, ['- [ ] 甲'], ['- [ ] 甲', '- [ ] 乙'], [inserted(1, 1)]);
        // Someone had edited the note, so this write could not be followed.
        claims.claim(FILE, ['他人の編集'], ['他人の編集'], [replaced(0)]);

        const next = claims.claim(FILE, ['- [ ] 甲'], ['- [x] 甲'], [replaced(0)]);
        expect(next.hint).toBeNull();

        // A scan committed, so the ledger is the authority again.
        claims.forget(FILE);

        const after = claims.claim(FILE, ['- [ ] 甲'], ['- [x] 甲'], [replaced(0)]);
        expect(after.hint!.rows).toEqual([{ runtimeId: 'r1', created: false, text: '- [x] 甲' }]);
    });

    it('claims a file the ledger knows nothing about as all new', () => {
        const claims = claimsWith([]);

        const claim = claims.claim(FILE, [''], ['- [ ] 初めての行'], [replaced(0)]);

        expect(claim.hint!.rows).toEqual([{ runtimeId: 'w1', created: true, text: '- [ ] 初めての行' }]);
    });
});

describe('WriteClaims: a base that no longer fits', () => {
    it('says nothing when a write it never heard of changed the file', () => {
        // Every write that does not file a claim leaves the base describing a
        // file that is no longer there: a write that reported nothing, a
        // report that did not account for its own lines, a writer with no sink
        // at all. None of them can be delivered here, so the base is checked
        // line for line instead — a row-by-row check would pass this, since
        // what changed is not a row.
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')], ['- [ ] 甲', 'memo']);

        const first = claims.claim(
            FILE,
            ['- [ ] 甲', 'memo'],
            ['- [ ] 甲', '- [ ] 甲', 'memo'],
            [inserted(0, 1)],
        );
        expect(first.hint!.rows.map(row => row.runtimeId)).toEqual(['w1', 'r1']);

        const between = ['- [ ] 甲', '- [ ] 甲', 'memo 書き足した'];
        const third = claims.claim(FILE, between, [...between, '- [ ] 丙'], [inserted(3, 1)]);

        // And not the ledger: it describes the file two writes ago, and its
        // line 0 is where the copy now sits. Reading it would hand the copy
        // the original's identity, with every text lining up, so the scan
        // would adopt it.
        expect(third.hint).toBeNull();

        // Nor the write after that one. Noticing that the file had moved is
        // not the same as the file having moved back: the ledger is exactly as
        // stale as it was a moment ago, and it stays that way until a scan
        // commits. A refusal that dropped the base would open it again here.
        const fourth = claims.claim(FILE, between, [...between, '- [ ] 丁'], [inserted(3, 1)]);
        expect(fourth.hint).toBeNull();
    });

    it('says nothing when a scan that read an older file has taken the base with it', () => {
        // A scan read the file before the first write landed, and committed
        // after that write filed its claim: the commit forgets the base
        // whatever the scan read, so the next write falls back to a ledger one
        // write old. Its row still fits — line 0 reads the same word — but
        // line 0 is now the copy. Built on that, the copy would be claimed as
        // the original, every text lining up; a scan comparing whole contents
        // would find this the only claim that fits and adopt it. The ledger's
        // content is the file before the copy, which is what refuses it.
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')]);

        const first = claims.claim(FILE, ['- [ ] 甲'], ['- [ ] 甲', '- [ ] 甲'], [inserted(0, 1)]);
        expect(first.hint!.rows.map(row => row.runtimeId)).toEqual(['w1', 'r1']);

        claims.forget(FILE);

        const second = claims.claim(
            FILE,
            ['- [ ] 甲', '- [ ] 甲'],
            ['- [ ] 甲', '- [ ] 甲', 'memo'],
            [inserted(2, 1)],
        );
        expect(second.hint).toBeNull();
    });

    it('says nothing when the content fits and a row does not', () => {
        // The content is compared by key, so the rows are checked as well: a
        // key two contents shared would still have to put every row's text on
        // its line. A ledger whose row sits off its own content stands in for
        // that here.
        const claims = claimsWith([known('r1', 1, '- [ ] 甲')], ['- [ ] 甲']);

        const claim = claims.claim(FILE, ['- [ ] 甲'], ['- [x] 甲'], [replaced(0)]);

        expect(claim.hint).toBeNull();
    });

    it('claims every row of a file no scan has read as new', () => {
        // The start-up scan skips a note with no list items. No row there has
        // a name anyone holds, so nothing can be handed to the wrong line.
        const claims = claimsWith([], null);

        const claim = claims.claim(FILE, ['prose'], ['prose', '- [ ] 初めての行'], [inserted(1, 1)]);

        expect(claim.hint!.rows).toEqual([{ runtimeId: 'w1', created: true, text: '- [ ] 初めての行' }]);
    });

    it('says nothing about a file with rows but no content on record', () => {
        // Not a state the ledger produces — it records both or neither — but
        // rows with no content cannot be checked, so they are not built on.
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')], null);

        const claim = claims.claim(FILE, ['- [ ] 甲'], ['- [x] 甲'], [replaced(0)]);

        expect(claim.hint).toBeNull();
    });

    it('builds the first task of a file with no rows on what the scan read', () => {
        const claims = claimsWith([], ['# 見出し', 'memo']);

        const claim = claims.claim(FILE, ['# 見出し', 'memo'], ['# 見出し', 'memo', '- [ ] 初'], [inserted(2, 1)]);

        expect(claim.hint!.rows).toEqual([{ runtimeId: 'w1', created: true, text: '- [ ] 初' }]);
    });

    it('says nothing about a file the parser refuses to read', () => {
        const claims = new WriteClaims(() => null, ledgerOf([known('r1', 0, '- [ ] 甲')]), mint());

        const claim = claims.claim(FILE, ['- [ ] 甲'], ['- [ ] 甲', '- [ ] 乙'], [inserted(1, 1)]);

        // Not "the file has no rows" — that would be a claim of its own.
        expect(claim.hint).toBeNull();
    });
});

describe('WriteClaims: a write that did not land', () => {
    it('takes back the base it left', () => {
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')]);

        const failed = claims.claim(FILE, ['- [ ] 甲'], ['- [ ] 甲', '- [ ] 乙'], [inserted(1, 1)]);
        // `vault.process` threw after the callback, so the file on disk is
        // still what this write was handed.
        failed.withdraw();

        const retry = claims.claim(FILE, ['- [ ] 甲'], ['- [ ] 甲', '- [ ] 丙'], [inserted(1, 1)]);
        expect(retry.hint!.rows).toEqual([
            { runtimeId: 'r1', created: false, text: '- [ ] 甲' },
            // Its own name, not the one the withdrawn write handed out: a
            // mint is spent whether or not the write it named landed.
            { runtimeId: 'w2', created: true, text: '- [ ] 丙' },
        ]);
    });

    it('puts back the base the write before it left', () => {
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')]);

        const first = claims.claim(FILE, ['- [ ] 甲'], ['- [ ] 甲', '- [ ] 甲'], [inserted(0, 1)]);
        expect(first.hint!.rows.map(row => row.runtimeId)).toEqual(['w1', 'r1']);

        const second = claims.claim(
            FILE,
            ['- [ ] 甲', '- [ ] 甲'],
            ['- [ ] 甲', '- [ ] 甲', '- [ ] 乙'],
            [inserted(2, 1)],
        );
        second.withdraw();

        // The first write's file is still the one on disk, and its base is
        // what knows that the copy is the upper line.
        const retry = claims.claim(
            FILE,
            ['- [ ] 甲', '- [ ] 甲'],
            ['- [ ] 甲', '- [ ] 甲', '- [ ] 丙'],
            [inserted(2, 1)],
        );
        expect(retry.hint!.rows.map(row => row.runtimeId)).toEqual(['w1', 'r1', 'w3']);
    });
});

describe('WriteClaims: the limit of a report', () => {
    it('cannot tell a copy above from a copy below', () => {
        // Both reports produce the same file, so nothing downstream can choose
        // between them: the check in `processLines` compares text, and the copy
        // is worded exactly like the line it copies. They decide opposite
        // things, and whichever is filed is the one believed.
        //
        // This is why a splice and its report come from one call
        // (`LineEdits.splice`) rather than two statements a writer has to keep
        // in step. What is pinned here is the shape of the mistake, so that a
        // report built any other way is known to carry it.
        const before = ['- [ ] 甲'];
        const after = ['- [ ] 甲', '- [ ] 甲'];
        const ledger = ledgerOf([known('r1', 0, '- [ ] 甲')]);

        const truthful = new WriteClaims(parseRows, ledger, mint())
            .claim(FILE, before, after, [inserted(1, 1)]);
        const offByOne = new WriteClaims(parseRows, ledger, mint())
            .claim(FILE, before, after, [inserted(0, 1)]);

        expect(truthful.hint!.rows.map(row => row.runtimeId)).toEqual(['r1', 'w1']);
        expect(offByOne.hint!.rows.map(row => row.runtimeId)).toEqual(['w1', 'r1']);
    });
});

describe('WriteClaims: a delete in a chain', () => {
    it('builds a delete on the insert that came just before it', () => {
        // Two writes to one file with no scan in between: the second is read
        // against what the first left. (A deletion fire used to be shaped like
        // this and is now a single write — see the report below that removes
        // and inserts at once.)
        const claims = claimsWith([known('r1', 0, '- [ ] 週報')]);

        const first = claims.claim(FILE, ['- [ ] 週報'], ['- [ ] 次', '- [ ] 週報'], [inserted(0, 1)]);
        expect(first.hint!.rows.map(row => row.runtimeId)).toEqual(['w1', 'r1']);

        const second = claims.claim(FILE, ['- [ ] 次', '- [ ] 週報'], ['- [ ] 次'], [removed(1, 1)]);

        // The written instance keeps the name the insert gave it and is still
        // told as new; the fired row is simply not there any more.
        expect(second.hint!.rows).toEqual([
            { runtimeId: 'w1', created: true, text: '- [ ] 次' },
        ]);
    });

    it('reads one report that removes and inserts, in the order it happened', () => {
        // A deletion fire is one write, so its report carries both edits. Each
        // one speaks in the line numbers as they stand at that moment: the
        // insert's `at` is read against the file the removal left, not against
        // the file as it was. `- [ ] 週報` is written where the fired
        // `- [ ] 週報` stood, so nothing but the report can tell the layer that
        // the surviving row is 兄弟 and the one reading 週報 is new.
        const claims = claimsWith([known('r1', 0, '- [ ] 兄弟'), known('r2', 1, '- [ ] 週報')]);

        const one = claims.claim(FILE,
            ['- [ ] 兄弟', '- [ ] 週報'],
            ['- [ ] 週報', '- [ ] 兄弟'],
            [removed(1, 1), inserted(0, 1)]);

        expect(one.hint!.rows).toEqual([
            { runtimeId: 'w1', created: true, text: '- [ ] 週報' },
            { runtimeId: 'r1', created: false, text: '- [ ] 兄弟' },
        ]);
    });

    it('reads the second edit in the wrong frame as a different file', () => {
        // What the frame is worth: the same two edits with the insert's `at`
        // counted against the file before the removal put the instance below
        // the survivor. Every row then comes out as the other one — the
        // instance wearing 兄弟's name, and a row that never moved called new.
        // `processLines` refuses such a report (it does not account for the
        // lines that were written), which is the guard this frame relies on.
        const claims = claimsWith([known('r1', 0, '- [ ] 兄弟'), known('r2', 1, '- [ ] 週報')]);

        const wrongFrame = claims.claim(FILE,
            ['- [ ] 兄弟', '- [ ] 週報'],
            ['- [ ] 週報', '- [ ] 兄弟'],
            [removed(1, 1), inserted(1, 1)]);

        expect(wrongFrame.hint!.rows).toEqual([
            { runtimeId: 'r1', created: false, text: '- [ ] 週報' },
            { runtimeId: 'w1', created: true, text: '- [ ] 兄弟' },
        ]);
    });

    it('stays silent about a delete that followed a write it could not follow', () => {
        // The same dependency the inserts have: once a write cannot be placed,
        // nothing is claimed about that file until a scan commits — a delete
        // included. Its own arithmetic being sound is not enough, because the
        // base it would be read against is the one that was lost.
        const claims = claimsWith([known('r1', 0, '- [ ] 甲'), known('r2', 1, '- [ ] 甲')]);
        claims.claim(FILE, ['他人の編集'], ['他人の編集'], [replaced(0)]);

        const next = claims.claim(FILE, ['- [ ] 甲', '- [ ] 甲'], ['- [ ] 甲'], [removed(0, 1)]);
        expect(next.hint).toBeNull();

        claims.forget(FILE);

        // And what it was holding back: of two lines reading the same word, the
        // one that survives is the one that survived.
        const after = claims.claim(FILE, ['- [ ] 甲', '- [ ] 甲'], ['- [ ] 甲'], [removed(0, 1)]);
        expect(after.hint!.rows).toEqual([{ runtimeId: 'r2', created: false, text: '- [ ] 甲' }]);
    });
});
