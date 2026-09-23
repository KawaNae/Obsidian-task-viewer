import { describe, it, expect } from 'vitest';
import { WriteClaims, type ClaimBase } from '../../../../../src/services/core/identity/WriteClaims';
import { FileParsePipeline } from '../../../../../src/services/parsing/FileParsePipeline';
import { DEFAULT_SETTINGS } from '../../../../../src/types';
import type { LineEdit } from '../../../../../src/utils/FileLines';
import { contentKeyOf } from '../../../../../src/services/core/identity/ContentKey';
import { ledgerRowsOf } from '../../../../../src/services/core/identity/IdentityMatcher';

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
    const parsed = FileParsePipeline.parse(path, [...lines], DEFAULT_SETTINGS);
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
    // The same rows as a ladder reads them, named by the row on each line.
    const ladder = read === null ? [] : ledgerRowsOf(parseRows(FILE, read) ?? [],
        task => rows.find(row => row.line === task.line)?.runtimeId ?? `unrecorded:${task.line}`);
    return () => ({ rows, ladder, content: read === null ? null : contentKeyOf(read) });
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

/**
 * The rows the newest write's record left, as a scan weighs them — or null
 * when that write could only leave a mark.
 */
function left(claims: WriteClaims): Array<{ runtimeId: string; created: boolean; text: string }> {
    const rows = claims.peek(FILE).left ?? null;
    return rows === null ? null! : rows.map(({ runtimeId, created, text }) => ({ runtimeId, created, text }));
}

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

        expect(claim.described).toBe(true);
        expect(left(claims)).toEqual([
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

        expect(left(claims)).toEqual([{ runtimeId: 'r1', created: false, text: '- [x] 報告 @2026-09-21' }]);
    });

    it('leaves a removed row out', () => {
        const before = ['- [ ] 甲', '- [ ] 乙'];
        const after = ['- [ ] 乙'];
        const claims = claimsWith([known('r1', 0, '- [ ] 甲'), known('r2', 1, '- [ ] 乙')]);

        const claim = claims.claim(FILE, before, after, [removed(0, 1)]);

        expect(left(claims)).toEqual([{ runtimeId: 'r2', created: false, text: '- [ ] 乙' }]);
    });

    it('says the rows are unchanged when a write touched no task line', () => {
        // Worth saying: it agrees with the state before it, so a scan that
        // reads either can adopt it (see matchFile).
        const before = ['- [ ] 甲', '\tmemo'];
        const after = ['- [ ] 甲', '\tmemo 書き足した'];
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')], before);

        const claim = claims.claim(FILE, before, after, [replaced(1)]);

        expect(left(claims)).toEqual([{ runtimeId: 'r1', created: false, text: '- [ ] 甲' }]);
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
        expect(left(claims).map(row => row.runtimeId)).toEqual(['w1', 'r1']);

        const second = claims.claim(
            FILE,
            ['- [ ] 甲', '- [ ] 甲'],
            ['- [ ] 甲', '- [ ] 甲', '- [ ] 丙'],
            [inserted(2, 1)],
        );

        // The copy keeps the name the first write gave it, and keeps being
        // told as new: no scan has recorded it yet, however many writes have
        // gone over the file since.
        expect(left(claims)).toEqual([
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
        expect(left(claims)).toEqual([{ runtimeId: 'r1', created: false, text: '- [x] 甲' }]);
    });

    it('says nothing when the file is not what either base describes', () => {
        // Someone edited the note between the last scan and this write.
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')]);

        const claim = claims.claim(FILE, ['- [ ] 手で書き換えた'], ['- [x] 手で書き換えた'], [replaced(0)]);

        expect(claim.described).toBe(false);
    });

    it('says nothing when the report does not fit the file it was given', () => {
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')]);

        const claim = claims.claim(FILE, ['- [ ] 甲'], ['- [ ] 甲', '- [ ] 乙'], [removed(5, 1)]);

        expect(claim.described).toBe(false);
    });

    it('stays silent after a write it could not follow, until a scan commits', () => {
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')]);
        claims.claim(FILE, ['- [ ] 甲'], ['- [ ] 甲', '- [ ] 乙'], [inserted(1, 1)]);
        // Someone had edited the note, so this write could not be followed.
        claims.claim(FILE, ['他人の編集'], ['他人の編集'], [replaced(0)]);

        const next = claims.claim(FILE, ['- [ ] 甲'], ['- [x] 甲'], [replaced(0)]);
        expect(next.described).toBe(false);

        // A scan committed, so the ledger is the authority again.
        claims.forget(FILE);

        const after = claims.claim(FILE, ['- [ ] 甲'], ['- [x] 甲'], [replaced(0)]);
        expect(left(claims)).toEqual([{ runtimeId: 'r1', created: false, text: '- [x] 甲' }]);
    });

    it('claims a file the ledger knows nothing about as all new', () => {
        const claims = claimsWith([]);

        const claim = claims.claim(FILE, [''], ['- [ ] 初めての行'], [replaced(0)]);

        expect(left(claims)).toEqual([{ runtimeId: 'w1', created: true, text: '- [ ] 初めての行' }]);
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
        expect(left(claims).map(row => row.runtimeId)).toEqual(['w1', 'r1']);

        const between = ['- [ ] 甲', '- [ ] 甲', 'memo 書き足した'];
        const third = claims.claim(FILE, between, [...between, '- [ ] 丙'], [inserted(3, 1)]);

        // And not the ledger: it describes the file two writes ago, and its
        // line 0 is where the copy now sits. Reading it would hand the copy
        // the original's identity, with every text lining up, so the scan
        // would adopt it.
        expect(third.described).toBe(false);

        // Nor the write after that one. Noticing that the file had moved is
        // not the same as the file having moved back: the ledger is exactly as
        // stale as it was a moment ago, and it stays that way until a scan
        // commits. A refusal that dropped the base would open it again here.
        const fourth = claims.claim(FILE, between, [...between, '- [ ] 丁'], [inserted(3, 1)]);
        expect(fourth.described).toBe(false);
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
        expect(left(claims).map(row => row.runtimeId)).toEqual(['w1', 'r1']);

        claims.forget(FILE);

        const second = claims.claim(
            FILE,
            ['- [ ] 甲', '- [ ] 甲'],
            ['- [ ] 甲', '- [ ] 甲', 'memo'],
            [inserted(2, 1)],
        );
        expect(second.described).toBe(false);
    });

    it('says nothing when the content fits and a row does not', () => {
        // The content is compared by key, so the rows are checked as well: a
        // key two contents shared would still have to put every row's text on
        // its line. A ledger whose row sits off its own content stands in for
        // that here.
        const claims = claimsWith([known('r1', 1, '- [ ] 甲')], ['- [ ] 甲']);

        const claim = claims.claim(FILE, ['- [ ] 甲'], ['- [x] 甲'], [replaced(0)]);

        expect(claim.described).toBe(false);
    });

    it('claims every row of a file no scan has read as new', () => {
        // The start-up scan skips a note with no list items. No row there has
        // a name anyone holds, so nothing can be handed to the wrong line.
        const claims = claimsWith([], null);

        const claim = claims.claim(FILE, ['prose'], ['prose', '- [ ] 初めての行'], [inserted(1, 1)]);

        expect(left(claims)).toEqual([{ runtimeId: 'w1', created: true, text: '- [ ] 初めての行' }]);
    });

    it('says nothing about a file with rows but no content on record', () => {
        // Not a state the ledger produces — it records both or neither — but
        // rows with no content cannot be checked, so they are not built on.
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')], null);

        const claim = claims.claim(FILE, ['- [ ] 甲'], ['- [x] 甲'], [replaced(0)]);

        expect(claim.described).toBe(false);
    });

    it('builds the first task of a file with no rows on what the scan read', () => {
        const claims = claimsWith([], ['# 見出し', 'memo']);

        const claim = claims.claim(FILE, ['# 見出し', 'memo'], ['# 見出し', 'memo', '- [ ] 初'], [inserted(2, 1)]);

        expect(left(claims)).toEqual([{ runtimeId: 'w1', created: true, text: '- [ ] 初' }]);
    });

    it('says nothing about a file the parser refuses to read', () => {
        const claims = new WriteClaims(() => null, ledgerOf([known('r1', 0, '- [ ] 甲')]), mint());

        const claim = claims.claim(FILE, ['- [ ] 甲'], ['- [ ] 甲', '- [ ] 乙'], [inserted(1, 1)]);

        // Not "the file has no rows" — that would be a claim of its own.
        expect(claim.described).toBe(false);
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
        expect(left(claims)).toEqual([
            { runtimeId: 'r1', created: false, text: '- [ ] 甲' },
            // Its own name, not the one the withdrawn write handed out: a
            // mint is spent whether or not the write it named landed.
            { runtimeId: 'w2', created: true, text: '- [ ] 丙' },
        ]);
    });

    it('puts back the base the write before it left', () => {
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')]);

        const first = claims.claim(FILE, ['- [ ] 甲'], ['- [ ] 甲', '- [ ] 甲'], [inserted(0, 1)]);
        expect(left(claims).map(row => row.runtimeId)).toEqual(['w1', 'r1']);

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
        expect(left(claims).map(row => row.runtimeId)).toEqual(['w1', 'r1', 'w3']);
    });

    it('does not paper over a later mark with the state from before it (F5b)', () => {
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')]);

        const failed = claims.claim(FILE, ['- [ ] 甲'], ['- [ ] 甲', '- [ ] 乙'], [inserted(1, 1)]);
        // A second write in flight was handed the file as it is on disk —
        // without the first write, which is about to fail — and could not
        // build on anything.
        const second = claims.claim(FILE, ['- [ ] 甲'], ['- [ ] 丙', '- [ ] 甲'], [inserted(0, 1)]);
        expect(second.described).toBe(false);
        failed.withdraw();

        // The mark stays: the ledger is still older than a write nobody
        // described, and the file does not read as the ledger says.
        expect(claims.peek(FILE).left).toBeNull();
        expect(claims.reading(FILE, ['- [ ] 丙', '- [ ] 甲'], 'write').base).toBeNull();
    });

    it('keeps a write that a later write was built on, whatever its caller was told (F5b)', () => {
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')]);

        const first = claims.claim(FILE, ['- [ ] 甲'], ['- [ ] 甲', '- [ ] 乙'], [inserted(1, 1)]);
        const second = claims.claim(FILE, ['- [ ] 甲', '- [ ] 乙'], ['- [ ] 甲', '- [ ] 乙', '- [ ] 丙'], [inserted(2, 1)]);
        expect(left(claims).map(row => row.runtimeId)).toEqual(['r1', 'w1', 'w2']);
        first.withdraw();

        // The second write fitted the file only because the first one's
        // content was there. What it left is still what the file reads.
        expect(claims.reading(FILE, ['- [ ] 甲', '- [ ] 乙', '- [ ] 丙'], 'write').base?.map(row => row.runtimeId))
            .toEqual(['r1', 'w1', 'w2']);
    });

    it('gives the previous state its rows back when the newest is taken back (F5b)', () => {
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')]);

        claims.claim(FILE, ['- [ ] 甲'], ['- [ ] 甲', '- [ ] 乙'], [inserted(1, 1)]);
        const second = claims.claim(FILE, ['- [ ] 甲', '- [ ] 乙'], ['- [ ] 甲', '- [ ] 乙', '- [ ] 丙'], [inserted(2, 1)]);
        second.withdraw();

        expect(claims.peek(FILE).left?.map(row => row.runtimeId)).toEqual(['r1', 'w1']);
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

        const truthful = new WriteClaims(parseRows, ledger, mint());
        truthful.claim(FILE, before, after, [inserted(1, 1)]);
        const offByOne = new WriteClaims(parseRows, ledger, mint());
        offByOne.claim(FILE, before, after, [inserted(0, 1)]);

        expect(left(truthful).map(row => row.runtimeId)).toEqual(['r1', 'w1']);
        expect(left(offByOne).map(row => row.runtimeId)).toEqual(['w1', 'r1']);
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
        expect(left(claims).map(row => row.runtimeId)).toEqual(['w1', 'r1']);

        const second = claims.claim(FILE, ['- [ ] 次', '- [ ] 週報'], ['- [ ] 次'], [removed(1, 1)]);

        // The written instance keeps the name the insert gave it and is still
        // told as new; the fired row is simply not there any more.
        expect(left(claims)).toEqual([
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

        expect(left(claims)).toEqual([
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

        expect(left(claims)).toEqual([
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
        expect(next.described).toBe(false);

        claims.forget(FILE);

        // And what it was holding back: of two lines reading the same word, the
        // one that survives is the one that survived.
        const after = claims.claim(FILE, ['- [ ] 甲', '- [ ] 甲'], ['- [ ] 甲'], [removed(0, 1)]);
        expect(left(claims)).toEqual([{ runtimeId: 'r2', created: false, text: '- [ ] 甲' }]);
    });
});

describe('WriteClaims.writerOf: whom the write that last wrote a row was made for (F6)', () => {
    const k = contentKeyOf;
    const ledgerLines = ['- [ ] A ==> every 1d', '- [ ] B'];
    const ledger = [known('r1', 0, ledgerLines[0]), known('r2', 1, ledgerLines[1])];

    it('names the origin of the write that gave the row the text the read holds', () => {
        const claims = claimsWith(ledger, ledgerLines);
        const w1 = ['- [x] A ==> every 1d', '- [ ] B'];
        claims.claim(FILE, ledgerLines, w1, [replaced(0)], 'user');
        const w2 = ['- [ ] A @2026-09-24 ==> every 1d', '- [x] A ==> every 1d', '- [ ] B'];
        claims.claim(FILE, w1, w2, [inserted(0, 1)], 'flow');
        // The user's check, as the flow's write carried it.
        expect(claims.writerOf(FILE, k(w2), k(ledgerLines), 'r1', '- [x] A ==> every 1d')).toBe('user');
        // The row the flow made.
        expect(claims.writerOf(FILE, k(w2), k(ledgerLines), 'w1', w2[0])).toBe('flow');
        // A row no write of ours wrote.
        expect(claims.writerOf(FILE, k(w2), k(ledgerLines), 'r2', '- [ ] B')).toBeNull();
    });

    it('holds only the writes a read of an earlier state holds', () => {
        const claims = claimsWith(ledger, ledgerLines);
        const w1 = ['- [ ] A ==> every 1d', '- [x] B'];
        claims.claim(FILE, ledgerLines, w1, [replaced(1)], 'flow');
        const w2 = ['- [ ] A ==> every 1d', '- [ ] B'];
        claims.claim(FILE, w1, w2, [replaced(1)], 'user');
        expect(claims.writerOf(FILE, k(w1), k(['x']), 'r2', '- [x] B')).toBe('flow');
    });

    it('answers nothing for the ledger\'s own lines, or a row read otherwise than the write left it', () => {
        const claims = claimsWith(ledger, ledgerLines);
        const w1 = ['- [x] A ==> every 1d', '- [ ] B'];
        claims.claim(FILE, ledgerLines, w1, [replaced(0)], 'user');
        expect(claims.writerOf(FILE, k(ledgerLines), k(ledgerLines), 'r1', ledgerLines[0])).toBeNull();
        const typed = ['- [x] A2 ==> every 1d', '- [ ] B', 'memo'];
        expect(claims.writerOf(FILE, k(typed), k(ledgerLines), 'r1', typed[0])).toBeNull();
        // Changed after our write, with the row as the write left it.
        const after = ['- [x] A ==> every 1d', '- [ ] B', 'memo'];
        expect(claims.writerOf(FILE, k(after), k(ledgerLines), 'r1', after[0])).toBe('user');
    });
});

describe('WriteClaims.writerOf: a write that could only leave a mark (F6)', () => {
    const k = contentKeyOf;
    const ledgerLines = ['- [ ] A ==> every 1d', '- [ ] B'];
    const ledger = [known('r1', 0, ledgerLines[0]), known('r2', 1, ledgerLines[1])];
    // A sync changed B before any scan read it: the write's lines are no state
    // on record, so it cannot build a claim, and leaves a mark.
    const synced = ['- [ ] A ==> every 1d', '- [ ] B synced'];
    const checked = ['- [x] A ==> every 1d', '- [ ] B synced'];

    it('still says the row it named, and for whom', () => {
        const claims = claimsWith(ledger, ledgerLines);
        const result = claims.claim(FILE, synced, checked, [replaced(0)], 'user', new Map([['r1', checked[0]]]));
        expect(result.described).toBe(false);
        expect(claims.writerOf(FILE, k(checked), k(ledgerLines), 'r1', checked[0])).toBe('user');
        expect(claims.writerOf(FILE, k(checked), k(ledgerLines), 'r2', checked[1])).toBeNull();
    });

    it('answers a flow for the rows a flow\'s mark named', () => {
        const claims = claimsWith(ledger, ledgerLines);
        claims.claim(FILE, synced, checked, [replaced(0)], 'flow', new Map([['r1', checked[0]]]));
        expect(claims.writerOf(FILE, k(checked), k(ledgerLines), 'r1', checked[0])).toBe('flow');
    });

    it('does not look past a mark that could not say which rows it wrote', () => {
        const claims = claimsWith(ledger, ledgerLines);
        const w1 = ['- [x] A ==> every 1d', '- [ ] B'];
        claims.claim(FILE, ledgerLines, w1, [replaced(0)], 'user');
        claims.silence(FILE);
        const read = ['- [x] A ==> every 1d', '- [ ] B', 'whole'];
        expect(claims.writerOf(FILE, k(read), k(ledgerLines), 'r1', read[0])).toBeNull();
    });
});

describe('changes counted against our writes (I1)', () => {
    const ONE = ['- [ ] A', ''];
    const TWO = ['- [x] A', ''];
    const edits: LineEdit[] = [{ kind: 'replaced', at: 0 }];

    it('a write waits for one modify; the next is outside', () => {
        const claims = claimsWith([], ONE);
        claims.claim(FILE, ONE, TWO, edits, 'user');
        expect(claims.peek(FILE)).toMatchObject({ links: ['record'], awaiting: 1 });
        claims.noteChange(FILE);
        expect(claims.peek(FILE)).toMatchObject({ links: ['record'], awaiting: 0 });
        claims.noteChange(FILE);
        expect(claims.peek(FILE)).toMatchObject({ links: ['record', 'foreign'], awaiting: 0 });
    });

    it('a write\'s modify that comes after a scan committed past it is still ours', () => {
        const claims = claimsWith();
        claims.claim(FILE, ONE, TWO, edits, 'user');
        claims.forget(FILE, { readMark: claims.readMark(), place: claims.reading(FILE, TWO, 'scan') });
        expect(claims.peek(FILE)).toMatchObject({ links: [], awaiting: 1 });
        claims.noteChange(FILE);
        expect(claims.peek(FILE)).toMatchObject({ links: [], awaiting: 0 });
    });

    it('a write taken back waits for nothing, even after a scan dropped it', () => {
        const claims = claimsWith();
        const kept = claims.claim(FILE, ONE, TWO, edits, 'user');
        kept.withdraw();
        expect(claims.peek(FILE)).toMatchObject({ links: [], awaiting: 0 });

        const dropped = claims.claim(FILE, ONE, TWO, edits, 'user');
        claims.forget(FILE, { readMark: claims.readMark(), place: claims.reading(FILE, TWO, 'scan') });
        dropped.withdraw();
        expect(claims.peek(FILE).awaiting).toBe(0);
        claims.noteChange(FILE);
        expect(claims.peek(FILE).links).toEqual(['foreign']);
    });

    it('a write another built on landed: taking it back keeps it waiting', () => {
        const claims = claimsWith([], ONE);
        const first = claims.claim(FILE, ONE, TWO, edits, 'user');
        claims.noteChange(FILE);
        claims.claim(FILE, TWO, ['- [x] A', 'x', ''], [{ kind: 'inserted', at: 1, count: 1 }], 'user');
        first.withdraw();
        expect(claims.peek(FILE)).toMatchObject({ links: ['record', 'record'], awaiting: 1 });
    });

    it('a delete or rename drops what was waiting', () => {
        const claims = claimsWith();
        claims.claim(FILE, ONE, TWO, edits, 'user');
        claims.dropFile(FILE);
        expect(claims.peek(FILE)).toMatchObject({ links: [], awaiting: 0 });
    });

    // Found by mutation testing (stage I1): once an outside change comes
    // after our write, a write reading the state put back is answered
    // through `nameRows`, not straight from the record's own rows — and
    // `nameRows` has to ask the chain whether each name was one a write of
    // ours made, rather than assume every name it re-derives is the
    // ledger's. A row this write created stays created however many outside
    // changes come and go around it.
    it('a row a write created keeps that flag once an outside change puts its state back', () => {
        const claims = claimsWith([], null);

        const first = claims.claim(FILE, [], ['- [ ] 甲'], [inserted(0, 1)]);
        expect(first.made).toEqual([{ line: 0, runtimeId: 'w1' }]);
        claims.noteChange(FILE); // our own write's modify
        claims.noteChange(FILE); // an outside change nobody reported

        const base = claims.reading(FILE, ['- [ ] 甲'], 'write').base;
        expect(base?.map(row => ({ runtimeId: row.runtimeId, created: row.created })))
            .toEqual([{ runtimeId: 'w1', created: true }]);
    });
});
