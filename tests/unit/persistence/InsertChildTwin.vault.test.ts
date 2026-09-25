import { describe, it, expect, afterEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import { TaskActionsMenuBuilder } from '../../../src/interaction/menu/builders/TaskActionsMenuBuilder';
import { TaskApi } from '../../../src/api/TaskApi';
import { TaskReadService } from '../../../src/services/data/TaskReadService';
import { TaskWriteService } from '../../../src/services/data/TaskWriteService';
import { t } from '../../../src/i18n';
import { openVault, type VaultSession } from '../helpers/vaultSession';

/**
 * A child added from a card's menu, the API or the CLI is written only where
 * the row the name was read in stands (the twins decision of 2026-09-25
 * 10:42): the check `WriteSession.row` makes of every write planned from the
 * index's copy (`plannedOn`), the reading's key included. A timer's record
 * takes the same check.
 *
 * The case is two twin rows and an edit from outside that the scan has not
 * read yet: a line put in above them brings the first twin onto the line the
 * second stood on. The row the name named is the second, so the child is not
 * written under the first: the write is refused, and the file left as it is.
 */

const FILE = 'note.md';
const TWINS = ['- [ ] 読書', '- [ ] 読書', ''];
const EDITED = ['メモ', '- [ ] 読書', '- [ ] 読書', ''].join('\n');

/** What the menu's "Add child task" dialog writes, once it is opened. */
let submitted: Promise<unknown> | undefined;

vi.mock('../../../src/modals/CreateTaskModal', () => ({
    formatTaskLine: () => '- [ ] c',
    CreateTaskModal: class {
        constructor(_app: unknown, private readonly submit: (result: unknown) => Promise<unknown>) { }
        open() { submitted = this.submit({}); }
    },
}));

let live: VaultSession[] = [];

afterEach(() => {
    for (const session of live) session.dispose();
    live = [];
    submitted = undefined;
    Notice.messages.length = 0;
});

async function open(lines: string[]) {
    const opened = await openVault(lines);
    live.push(opened.session);
    return opened;
}

/** The second of the two twins, as the index read it. */
function secondTwin(session: VaultSession) {
    const found = session.index.getTasks().filter(task => task.file === FILE && task.line === 1);
    expect(found).toHaveLength(1);
    return found[0];
}

/** A menu that keeps each item's title and click. */
function recordingMenu() {
    const clicks = new Map<string, () => unknown>();
    const menu = {
        addItem(build: (item: unknown) => void) {
            let title = '';
            const item = {
                setTitle(value: string) { title = value; return item; },
                setIcon() { return item; },
                setWarning() { return item; },
                setChecked() { return item; },
                setSubmenu() { return menu; },
                onClick(fn: () => unknown) { clicks.set(title, fn); return item; },
            };
            build(item);
            return menu;
        },
        addSeparator() { return menu; },
        close() { },
    };
    return { menu, clicks };
}

async function addChildFromCardMenu(session: VaultSession, task: ReturnType<typeof secondTwin>): Promise<void> {
    const plugin = { settings: { startHour: 0 }, getTimerWidget: () => undefined };
    const builder = new TaskActionsMenuBuilder(session.app as never, new TaskWriteService(session.index), plugin as never);
    const { menu, clicks } = recordingMenu();
    builder.addChildActions(menu as never, task);
    await clicks.get(t('menu.addChildTask'))!();
    await submitted;
}

function apiOver(session: VaultSession): TaskApi {
    const plugin = {
        app: session.app,
        settings: { startHour: 0 },
        getTaskReadService: () => new TaskReadService(session.index, 0),
        getTaskWriteService: () => new TaskWriteService(session.index),
    };
    return new TaskApi(plugin as never);
}

describe('a child added from a card\'s menu', () => {
    it('is written under the row the card shows', async () => {
        const { contents, session } = await open(TWINS);
        await addChildFromCardMenu(session, secondTwin(session));
        expect(contents.get(FILE)).toBe(['- [ ] 読書', '- [ ] 読書', '	- [ ] c', ''].join('\n'));
    });

    it('is refused, not written under the other twin, while the file holds an edit the scan has not read', async () => {
        const { contents, session } = await open(TWINS);
        const task = secondTwin(session);
        contents.set(FILE, EDITED);

        await addChildFromCardMenu(session, task);
        expect(contents.get(FILE)).toBe(EDITED);
        expect(Notice.messages).toHaveLength(1);
    });
});

describe('a child added through the API (and the CLI, which calls it)', () => {
    it('is refused, not written under the other twin, while the file holds an edit the scan has not read', async () => {
        const { contents, session } = await open(TWINS);
        const api = apiOver(session);
        const id = (await api.list()).tasks.find(task => task.line === 1)!.id;
        contents.set(FILE, EDITED);

        await expect(api.insertChildTask({ parentId: id, content: 'c' })).rejects.toThrow(/could not be written/);
        expect(contents.get(FILE)).toBe(EDITED);
    });
});

describe('a child appended at the end of a row\'s children', () => {
    it('is refused, not written under the other twin, while the file holds an edit the scan has not read', async () => {
        const { contents, session } = await open(TWINS);
        const task = secondTwin(session);
        contents.set(FILE, EDITED);

        expect(await session.index.appendChildTask(task.id, '- [ ] c')).toBe(false);
        expect(contents.get(FILE)).toBe(EDITED);
    });
});

describe('a timer\'s record (the same check as every write)', () => {
    // A timer's record now takes the same check as every write: a row only
    // indented since the scan is refused, the same as any other row that
    // changed since the reading.
    const INDENTED = ['- [ ] P', '\t- [ ] T', ''].join('\n');

    async function indentedSinceTheScan() {
        const { contents, session } = await open(['- [ ] P', '- [ ] T', '']);
        const task = session.index.getTasks().find(row => row.content === 'T')!;
        contents.set(FILE, INDENTED);
        return { contents, session, task };
    }

    it('is refused as a first child on a row only indented since the scan', async () => {
        const { contents, session, task } = await indentedSinceTheScan();
        expect(await session.index.insertRecord(task.id, '- [x] rec', 'firstChild')).toBe(false);
        expect(contents.get(FILE)).toBe(INDENTED);
    });

    it('is refused as a next sibling on a row only indented since the scan', async () => {
        const { contents, session, task } = await indentedSinceTheScan();
        expect(await session.index.insertRecord(task.id, '- [x] rec', 'afterSubtree')).toBe(false);
        expect(contents.get(FILE)).toBe(INDENTED);
    });
});
