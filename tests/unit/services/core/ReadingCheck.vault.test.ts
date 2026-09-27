import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Notice } from 'obsidian';
import { t } from '../../../../src/i18n';
import { openLiveVault, type VaultSession } from '../../helpers/vaultSession';

/**
 * Before an operation is planned from the index's copy of a row, the copy is
 * checked against the disk (`TaskIndex.copyToPlan`, structure.md の読みの鮮度):
 * an edit from outside whose change event never came is found there, the
 * note is read again, and the operation is given up with one notice asking
 * the user to try again — from the new reading, where it is written.
 *
 * Setting `contents` without writing through the index is exactly that edit:
 * no `modify`, no scan.
 */

const FILE = 'note.md';
const NOTE = ['- [ ] A @2026-09-21', '- [ ] B @2026-09-21', ''];
const OUTSIDE = ['メモ', '- [ ] A @2026-09-21', '- [ ] B @2026-09-21', ''].join('\n');

const readAgain = (subject: string) => t('notice.readAgain', { subject });

let live: VaultSession | undefined;
afterEach(() => { live?.dispose(); live = undefined; });
beforeEach(() => { Notice.messages.length = 0; });

const open = (lines: string[] = NOTE) => openLiveVault({ [FILE]: lines }, (s) => { live = s; });

function idOf(session: VaultSession, content: string): string {
    const task = session.index.getTasks().find(row => row.file === FILE && row.content === content);
    if (!task) throw new Error(`no row reads ${content}`);
    return task.id;
}

describe('an operation over an edit from outside that no scan has read', () => {
    const operations: [string, (s: VaultSession, id: string) => Promise<boolean>][] = [
        ['updateTask', (s, id) => s.index.updateTask(id, { statusChar: 'x' })],
        ['deleteTask', (s, id) => s.index.deleteTask(id)],
        ['deleteTask with its fire', (s, id) => s.index.deleteTask(id, { fireFlow: true })],
        ['duplicateTask', (s, id) => s.index.duplicateTask(id)],
        ['insertLine', (s, id) => s.index.insertLine(id, '- [ ] child', 'firstChild')],
    ];

    for (const [name, operate] of operations) {
        it(`${name}: writes nothing, answers no, and says so once, as a reading to try again from`, async () => {
            const { contents, session } = await open();
            const id = idOf(session, 'A');
            contents.set(FILE, OUTSIDE);

            expect(await operate(session, id)).toBe(false);

            expect(contents.get(FILE)).toBe(OUTSIDE);
            // The check's notice, and not the write's refusal besides.
            expect(Notice.messages).toEqual([readAgain('A')]);
        });

        it(`${name}: the index has read the note by then, and the operation by the new name is written`, async () => {
            const { contents, session } = await open();
            const id = idOf(session, 'A');
            contents.set(FILE, OUTSIDE);
            await operate(session, id);
            Notice.messages.length = 0;

            const now = idOf(session, 'A');
            expect(now).not.toBe(id);
            expect(session.index.getTask(now)?.line).toBe(1);
            expect(await operate(session, now)).toBe(true);
            expect(contents.get(FILE)).not.toBe(OUTSIDE);
            expect(Notice.messages).toEqual([]);
        });
    }

    it('after a write of ours, a name from before it is carried across it and written', async () => {
        const { contents, session } = await open();
        const a = idOf(session, 'A');
        const b = idOf(session, 'B');

        expect(await session.index.duplicateTask(a)).toBe(true);
        expect(await session.index.updateTask(b, { statusChar: 'x' })).toBe(true);

        expect(contents.get(FILE)).toContain('- [x] B @2026-09-21');
        expect(Notice.messages).toEqual([]);
    });

    it('a check asked while a write of ours to the note is under way waits for it: the check reads in line with our writes', async () => {
        const { contents, session } = await open();
        const a = idOf(session, 'A');
        const b = idOf(session, 'B');
        // B's operation is asked once A's copy is on the disk, before the
        // index is told what A's write left (its change event comes first
        // here). Read out of line, the check would find the disk ahead of
        // the index and call B's copy stale.
        const scanner = session.scannerPrivates;
        const queueScan = scanner.queueScan.bind(scanner);
        let second: Promise<boolean> | undefined;
        scanner.queueScan = (file) => {
            second ??= session.index.updateTask(b, { statusChar: 'x' });
            return queueScan(file);
        };

        expect(await session.index.duplicateTask(a)).toBe(true);
        expect(await second).toBe(true);

        expect(contents.get(FILE)).toBe(['- [ ] A @2026-09-21', '- [ ] A @2026-09-21', '- [x] B @2026-09-21', ''].join('\n'));
        expect(Notice.messages).toEqual([]);
    });

    it('during a drag, a write by a name from before the drag is written: the reading since is held, not stale', async () => {
        const { contents, session } = await open();
        const a = idOf(session, 'A');
        const b = idOf(session, 'B');
        session.index.setDraggingFile(FILE);

        expect(await session.index.duplicateTask(a)).toBe(true);
        expect(await session.index.updateTask(b, { statusChar: 'x' })).toBe(true);
        session.index.setDraggingFile(null);

        expect(contents.get(FILE)).toContain('- [x] B @2026-09-21');
        expect(Notice.messages).toEqual([]);
    });

    it('a note that cannot be read: nothing written, no throw, one notice', async () => {
        const { contents, session } = await open();
        const id = idOf(session, 'A');
        contents.delete(FILE);

        expect(await session.index.updateTask(id, { statusChar: 'x' })).toBe(false);

        expect(contents.has(FILE)).toBe(false);
        expect(Notice.messages).toEqual([t('notice.notReadable', { subject: 'A' })]);
    });
});

describe('the entry check (`confirmTask`)', () => {
    it('answers yes for a fresh copy and says nothing', async () => {
        const { session } = await open();
        expect(await session.index.confirmTask(idOf(session, 'A'), 'menu')).toBe(true);
        expect(Notice.messages).toEqual([]);
    });

    it('answers no over an edit from outside, reads the note again, and says so once', async () => {
        const { contents, session } = await open();
        const id = idOf(session, 'A');
        contents.set(FILE, OUTSIDE);

        expect(await session.index.confirmTask(id, 'drag')).toBe(false);

        expect(Notice.messages).toEqual([readAgain('A')]);
        expect(session.index.getTask(idOf(session, 'A'))?.line).toBe(1);
    });
});

describe('a row named by its anchor (`freshByAnchor`)', () => {
    it('is looked up in a reading of the note as the disk holds it, and written where its anchor is now', async () => {
        const { contents, session } = await open(['- [ ] A ^keep', '- [ ] A', '']);
        contents.set(FILE, ['メモ', '- [ ] A', '- [ ] A ^keep', ''].join('\n'));

        const row = await session.index.freshByAnchor(FILE, 'keep');
        expect(row?.line).toBe(2);
        expect(await session.index.updateTask(row!.id, { statusChar: 'x' })).toBe(true);

        expect(contents.get(FILE)).toBe(['メモ', '- [ ] A', '- [x] A ^keep', ''].join('\n'));
        expect(Notice.messages).toEqual([]);
    });

    it('its twin without an anchor, named by a reading from before the edit, is not written (contract 3)', async () => {
        const { contents, session } = await open(['- [ ] A ^keep', '- [ ] A', '']);
        const twin = session.index.getTasks().find(row => row.line === 1)!.id;
        const edited = ['- [ ] A', '- [ ] A ^keep', ''].join('\n');
        contents.set(FILE, edited);

        expect(await session.index.updateTask(twin, { statusChar: 'x' })).toBe(false);

        expect(contents.get(FILE)).toBe(edited);
        expect(Notice.messages).toEqual([readAgain('A')]);
    });

    it('finds nothing once its anchor is gone', async () => {
        const { contents, session } = await open(['- [ ] A ^keep', '']);
        contents.set(FILE, ['- [ ] A', ''].join('\n'));

        expect(await session.index.freshByAnchor(FILE, 'keep')).toBeUndefined();
    });
});
