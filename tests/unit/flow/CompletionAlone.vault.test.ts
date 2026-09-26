import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import { contentKeyOf } from '../../../src/services/core/ContentKey';
import { FlowExecutor } from '../../../src/services/flow/FlowExecutor';
import { t } from '../../../src/i18n';
import { openVault, type VaultSession } from '../helpers/vaultSession';
import { editorSession } from '../helpers/editorSession';
import { freezeDate } from '../helpers/fakeDate';

/**
 * A completion whose fire cannot be written where its lines go
 * (`unplaceable`, `disturbs`) is written alone, in the same write: the
 * completion is the user's, as one made in the editor stands when its fire
 * is refused. One `vault.process`, so nothing written from outside comes
 * between the refused fire and the completion; and one notice, which says the
 * row was completed and the flow was not run.
 *
 * The shape is F8's (R2): `Para` / `- [ ] A ==> move()` / `---` — taking the
 * row out would make the paragraph and the rule a setext heading.
 */

freezeDate(new Date(2026, 8, 25, 12, 0, 0));

const FILE = 'note.md';
const NOTE = ['# note', 'Para', '- [ ] A ==> move()', '---', ''];
const DONE = ['# note', 'Para', '- [x] A ==> move()', '---', ''];

let live: VaultSession | undefined;
beforeEach(() => { Notice.messages.length = 0; });
afterEach(() => { live?.dispose(); live = undefined; });

async function open(note: string[] = NOTE) {
    const { contents, session } = await openVault({ [FILE]: note });
    live = session;
    let processed = 0;
    const vault = session.app.vault as unknown as { process: (...args: unknown[]) => Promise<string> };
    const process = vault.process.bind(vault);
    vault.process = (...args) => { processed++; return process(...args); };
    return { contents, session, processed: () => processed };
}

describe('a completion whose fire would disturb the note', () => {
    it('is written alone in one write, from a card', async () => {
        const note = await open();
        const id = note.session.index.getTasks().find(t => t.content === 'A')!.id;
        expect(await note.session.index.updateTask(id, { statusChar: 'x' })).toBe(true);
        await note.session.flowSettled(FILE);
        expect(note.contents.get(FILE)).toBe(DONE.join('\n'));
        expect(note.processed()).toBe(1);
        expect(Notice.messages).toHaveLength(1);
        expect(Notice.messages[0]).toMatch(/^The task was completed, but its flow was not run: .*heading.* \(A\)$/);
    });

    it('is written alone in one write, from the editor menu on a note no editor shows', async () => {
        const note = await open();
        const at = { line: 2, text: NOTE[2], key: contentKeyOf(NOTE) };
        expect(await note.session.index.writeLine(FILE, at, [{ kind: 'update', text: DONE[2] }])).toBe(true);
        await note.session.flowSettled(FILE);
        expect(note.contents.get(FILE)).toBe(DONE.join('\n'));
        expect(note.processed()).toBe(1);
        expect(Notice.messages).toHaveLength(1);
        expect(Notice.messages[0]).toMatch(/^The task was completed, but its flow was not run: .*heading/);
    });
});

/**
 * A completion whose fire could not be planned is written, and told in the
 * same words as one whose fire's write was refused: the task was completed,
 * the flow was not run, and why (`FlowExecutor.reportNotRun`).
 */
describe('a completion whose fire could not be planned', () => {
    const FAILS = ['# note', '- [ ] A @2026-09-21 ==> at(end + 1d)', ''];
    const told = /^The task was completed, but its flow was not run: Property 'end' is not set on this task.* \(A\)$/;

    it('is written, and told the flow was not run, from a card', async () => {
        const note = await open(FAILS);
        const id = note.session.index.getTasks().find(t => t.content === 'A')!.id;
        expect(await note.session.index.updateTask(id, { statusChar: 'x' })).toBe(true);
        await note.session.flowSettled(FILE);
        expect(note.contents.get(FILE)).toBe(['# note', '- [x] A @2026-09-21 ==> at(end + 1d)', ''].join('\n'));
        expect(Notice.messages).toHaveLength(1);
        expect(Notice.messages[0]).toMatch(told);
    });

    it('stands in the editor, told the same', async () => {
        const note = await open(FAILS);
        const editor = editorSession(note.session.index.editorFireHost(), FILE, note.contents.get(FILE)!);
        editor.check(1);
        await Promise.resolve();
        expect(editor.lines()[1]).toBe('- [x] A @2026-09-21 ==> at(end + 1d)');
        expect(Notice.messages).toHaveLength(1);
        expect(Notice.messages[0]).toMatch(told);
    });
});

/**
 * Whether a completion stands without its fire is one rule, read the same by
 * a card's write and the editor's: a fire that writes something is tried
 * without, whatever its write was refused for. The fire here takes the row
 * away and then asks for it again, so its write is refused as `gone`, which
 * is no refusal of where its lines go; the completion alone is written all
 * the same. A refusal of the completion's own (the note edited from outside,
 * `changed`) comes before the fire is planned, and the completion is not
 * written: `StalePlan.vault.test.ts`.
 */
describe('a completion whose fire is refused for a reason not of where its lines go', () => {
    const ROW = ['# note', '- [ ] A @2026-09-21', '- [ ] B', ''];
    const CHECKED = ['# note', '- [x] A @2026-09-21', '- [ ] B', ''];

    /** The fire planned for the row: taken away, then its command stripped. */
    function refusedAsGone(session: VaultSession) {
        const task = session.index.getTasks().find(t => t.content === 'A')!;
        vi.spyOn(FlowExecutor.prototype, 'planFire').mockImplementation(() =>
            ({ kind: 'fires', task, ops: [{ kind: 'remove' }, { kind: 'strip-flow', text: '- [x] A @2026-09-21' }] }));
        return task;
    }

    afterEach(() => { vi.restoreAllMocks(); });

    it('is written alone from a card, in one write, and told the flow was not run', async () => {
        const note = await open(ROW);
        const task = refusedAsGone(note.session);
        expect(await note.session.index.updateTask(task.id, { statusChar: 'x' })).toBe(true);
        await note.session.flowSettled(FILE);
        expect(note.contents.get(FILE)).toBe(CHECKED.join('\n'));
        expect(note.processed()).toBe(1);
        expect(Notice.messages).toEqual([t('notice.flowNotRun', { reason: t('notice.refusedGone'), subject: 'A' })]);
    });

    it('stands in the editor, told the same', async () => {
        const note = await open(ROW);
        refusedAsGone(note.session);
        const editor = editorSession(note.session.index.editorFireHost(), FILE, note.contents.get(FILE)!);
        editor.check(1);
        expect(editor.lines()).toEqual(CHECKED);
        expect(Notice.messages).toEqual([t('notice.flowNotRun', { reason: t('notice.refusedGone'), subject: '- [x] A @2026-09-21' })]);
    });
});
