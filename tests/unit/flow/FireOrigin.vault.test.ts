import { describe, it, expect, vi } from 'vitest';
import { vaultSession, makeFile } from '../helpers/vaultSession';
import type { Task } from '../../../src/types';
import { EDITOR_SIGNAL_LIFETIME_MS } from '../../../src/services/core/EditorSignal';

/**
 * Whether a completion fires is answered row by row (structure.md,
 * 「自己書き込みの判定と発火の可否」, 論点5): a row a write of ours wrote
 * answers by whom the write was for — the user fires, a flow's own write does
 * not — and a row no write of ours wrote fires only on the editor's signal.
 * Before F6 one flag per path answered for the whole file, set by the index's
 * CRUD and by any mousedown in an editor, and consumed by whichever `modify`
 * came first.
 */

const FILE = 'note.md';

interface Fired { count: number; contents: string[] }

function open(lines: string[]) {
    const contents = new Map([[FILE, lines.join('\n')]]);
    const session = vaultSession(contents);
    const executor = session.executor;
    const fired: Fired = { count: 0, contents: [] };
    const original = executor.handleTaskCompletion.bind(executor);
    executor.handleTaskCompletion = (task: Task) => {
        fired.count++;
        fired.contents.push(task.content);
        return original(task);
    };
    const settled = async () => {
        await vi.waitFor(() => expect(executor.isProcessing).toBe(false));
        await session.settle(FILE);
        await vi.waitFor(() => expect(executor.isProcessing).toBe(false));
    };
    return {
        contents,
        session,
        fired,
        settled,
        idOf: (content: string) => session.index.getTasks().find(t => t.content === content)!.id,
        /** Someone typed or clicked in the note's editor, and it saved `text`. */
        byHand: async (text: string[]) => {
            session.markEditor(FILE);
            contents.set(FILE, text.join('\n'));
            await session.fireVault('modify', makeFile(FILE));
            await settled();
        },
        /** Something outside the editor (a sync) wrote `text`. */
        fromOutside: async (text: string[]) => {
            contents.set(FILE, text.join('\n'));
            await session.fireVault('modify', makeFile(FILE));
            await settled();
        },
        lines: () => contents.get(FILE)!.split('\n'),
    };
}

describe('a flow\'s own writes', () => {
    // G1's decision (2026-09-21): a generated child that reads completed and
    // carries a command of its own is let through. Written by the flow, it
    // must not fire; checked again by the user, it fires once, like any
    // recurring task.
    const GEN_NOTE = [
        '# note', '- [ ] 親 @2026-09-21', '\t- ==> every mon use("w")', '',
        '```tv-gen w', '- [ ] 親', '\t- [x] 生成子 ==> every 1d', '```', '',
    ];

    async function fired() {
        const note = open(GEN_NOTE);
        await note.session.scanAll();
        await note.session.index.updateTask(note.idOf('親'), { statusChar: 'x' });
        await note.settled();
        return note;
    }

    it('do not fire the completed child a block generated, when it is written', async () => {
        const note = await fired();
        expect(note.lines().filter(line => line.includes('生成子'))).toHaveLength(2);   // the block's, and the instance's
        expect(note.fired.contents).toEqual(['親']);
    });

    it('let the user fire that child once by checking it again on a card', async () => {
        const note = await fired();
        const child = note.session.index.getTasks().find(t => t.content === '生成子' && !t.file.includes('```'))!;
        await note.session.index.updateTask(child.id, { statusChar: ' ' });
        await note.settled();
        await note.session.index.updateTask(child.id, { statusChar: 'x' });
        await note.settled();
        expect(note.fired.contents).toEqual(['親', '生成子']);
    });

    it('let the user fire that child once by checking it again in the editor', async () => {
        const note = await fired();
        const lines = note.lines();
        const at = lines.findIndex(line => line.includes('- [x] 生成子 ==> every 1d') && line.startsWith('\t'));
        expect(at).toBeGreaterThan(0);
        const unchecked = [...lines];
        unchecked[at] = unchecked[at].replace('[x]', '[ ]');
        await note.byHand(unchecked);
        await note.byHand(lines);
        expect(note.fired.contents).toEqual(['親', '生成子']);
    });
});

describe('the user\'s completions', () => {
    const TWO = ['# note', '- [ ] 甲 @2026-09-21 ==> every mon', '- [ ] 乙 @2026-09-21 ==> every mon', ''];

    it('fire both of two checks written back to back, the second not taken for a sync', async () => {
        const note = open(TWO);
        await note.session.scanAll();
        await Promise.all([
            note.session.index.updateTask(note.idOf('甲'), { statusChar: 'x' }),
            note.session.index.updateTask(note.idOf('乙'), { statusChar: 'x' }),
        ]);
        await note.settled();
        expect(note.fired.contents.sort()).toEqual(['乙', '甲']);
    });

    it('fire every row one hand edit completed (a paste, several cursors, a parent and child)', async () => {
        const note = open(TWO);
        await note.session.scanAll();
        await note.byHand(['# note', '- [x] 甲 @2026-09-21 ==> every mon', '- [x] 乙 @2026-09-21 ==> every mon', '']);
        expect(note.fired.contents.sort()).toEqual(['乙', '甲']);
    });

    it('fire a hand completion in the editor once', async () => {
        const note = open(TWO);
        await note.session.scanAll();
        await note.byHand(['# note', '- [x] 甲 @2026-09-21 ==> every mon', '- [ ] 乙 @2026-09-21 ==> every mon', '']);
        expect(note.fired.contents).toEqual(['甲']);
    });

    it('fire a hand completion that a write of ours reached the file before', async () => {
        // The editor's save comes after its debounce; a card's write to
        // another row lands first. Before F6 that write's modify took the
        // editor's flag, and the hand completion read as a sync.
        const note = open(TWO);
        await note.session.scanAll();
        note.session.markEditor(FILE);
        await note.session.index.updateTask(note.idOf('乙'), { content: '乙2' });
        await note.settled();
        const lines = note.lines();
        await note.fromOutside(lines.map(line => line.replace('- [ ] 甲', '- [x] 甲')));
        expect(note.fired.contents).toEqual(['甲']);
    });
});

describe('what is not the user\'s', () => {
    const ONE = ['# note', '- [ ] 甲 @2026-09-21 ==> every mon', '- [ ] 乙', ''];

    it('a completion from outside does not fire', async () => {
        const note = open(ONE);
        await note.session.scanAll();
        await note.fromOutside(['# note', '- [x] 甲 @2026-09-21 ==> every mon', '- [ ] 乙', '']);
        expect(note.fired.count).toBe(0);
    });

    it('a sync\'s completion does not fire on the signal of a hand edit that completed nothing', async () => {
        // Found by F6's counterexample run (F1): the signal was taken only by a
        // scan with a row to decide, so a hand edit that completed nothing left
        // it up, and the next sync's completion (another device's, already
        // fired there) fired here too.
        const note = open(ONE);
        await note.session.scanAll();
        await note.byHand(['# note', '- [ ] 甲 @2026-09-21 ==> every mon', '- [ ] 乙 typed', '']);
        await note.fromOutside(['# note', '- [x] 甲 @2026-09-21 ==> every mon', '- [ ] 乙 typed', '']);
        expect(note.fired.count).toBe(0);
    });

    it('a sync\'s completion does not fire on a signal older than its lifetime', async () => {
        // A hand in the editor whose save never reached a scan (typed and
        // undone), with writes of ours in between, which leave it standing.
        const note = open(ONE);
        await note.session.scanAll();
        note.session.markEditor(FILE);
        await note.session.index.updateTask(note.idOf('乙'), { content: '乙2' });
        await note.settled();
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now + EDITOR_SIGNAL_LIFETIME_MS + 1);
        try {
            await note.fromOutside(note.lines().map(line => line.replace('- [ ] 甲', '- [x] 甲')));
        } finally {
            vi.restoreAllMocks();
        }
        expect(note.fired.count).toBe(0);
    });

    it('a write that changed nothing leaves nothing behind for a sync to fire on', async () => {
        // A write that produces the same bytes has no modify to consume a
        // flag. Before F6 the CRUD's flag stayed, and the next sync fired.
        const note = open(ONE);
        await note.session.scanAll();
        await note.session.index.updateTask(note.idOf('乙'), { statusChar: ' ' });
        await note.settled();
        expect(note.lines()).toEqual(ONE);
        await note.fromOutside(['# note', '- [x] 甲 @2026-09-21 ==> every mon', '- [ ] 乙', '']);
        expect(note.fired.count).toBe(0);
    });
});
