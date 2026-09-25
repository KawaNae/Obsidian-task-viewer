import { describe, it, expect, afterEach } from 'vitest';
import { openVault, type VaultSession } from '../helpers/vaultSession';
import type { Refusal } from '../../../src/utils/FileLines';

/**
 * The two writes that used to report nothing — a key set in the frontmatter,
 * a line put under a heading — report like every other one (F5).
 *
 * Both move every row below them without touching a row. Unreported, the next
 * scan could not adopt any claim (the ledger no longer fit the file) and fell
 * to the ladder, and the ladder handed an indented task under the heading to
 * the new line above it (F4's report, F6). Reported, the scan believes the
 * write, and the write that follows can build on it.
 */

const FILE = 'note.md';

let live: VaultSession | undefined;
let contents = new Map<string, string>();
afterEach(() => {
    live?.dispose();
    live = undefined;
});

async function open(text: string): Promise<VaultSession> {
    const opened = await openVault(text);
    contents = opened.contents;
    live = opened.session;
    return live;
}

function idByText(session: VaultSession): Map<string, string> {
    return new Map(session.index.getTasks()
        .filter(task => task.file === FILE)
        .map(task => [task.originalText.trim(), task.id]));
}

/** Claims filed and adopted, counted on the log itself (see ChildInsertClaims.test.ts). */
function watchClaims(session: VaultSession) {
    const log = session.scanner.getHintLog() as unknown as {
        add: (file: string, hints: unknown[], now: number) => () => void;
        settle: (file: string, consumed: number, moved: boolean) => void;
    };
    const filed: string[] = [];
    const adopted: string[] = [];
    const add = log.add.bind(log);
    const settle = log.settle.bind(log);
    log.add = (file, hints, now) => {
        if (hints.length > 0) filed.push(file);
        return add(file, hints, now);
    };
    log.settle = (file, consumed, moved) => {
        if (consumed > 0) adopted.push(file);
        settle(file, consumed, moved);
    };
    return { filed, adopted };
}

function watchRefusals(session: VaultSession): Refusal[] {
    const refused: Refusal[] = [];
    const observer = session.index.getRepository().getWriteObserver();
    observer.connect(file => {
        const channel = session.channelOf(file);
        return { ...channel, refused: (refusal: Refusal) => { refused.push(refusal); channel.refused(refusal); } } as never;
    });
    return refused;
}

describe('a line put under a heading', () => {
    it('keeps the names of the indented tasks directly under the heading (F4, F6)', async () => {
        // Two spaces: a tab under a heading is indented code
        // (Obsidian, measurement.md q10), and holds no task (the next test).
        const session = await open(['## Tasks', '  - [ ] A', '\t- [ ] B', ''].join('\n'));
        const before = idByText(session);
        expect(before.get('- [ ] A')).toBeDefined();
        expect(before.get('- [ ] B')).toBeDefined();
        const claims = watchClaims(session);

        await session.index.createTask(FILE, '- [ ] N', 'Tasks');
        await session.settle(FILE);

        // At A's indentation, as its sibling: A is not made N's child (P1).
        expect(contents.get(FILE)!.split('\n')).toEqual(['## Tasks', '  - [ ] N', '  - [ ] A', '\t- [ ] B', '']);
        const after = idByText(session);
        expect(after.get('- [ ] A')).toBe(before.get('- [ ] A'));
        expect(after.get('- [ ] B')).toBe(before.get('- [ ] B'));
        expect(claims.adopted).toEqual([FILE]);
        const byContent = new Map(session.index.getTasks().filter(task => task.file === FILE).map(task => [task.content, task]));
        expect(byContent.get('A')?.parentId).toBeUndefined();
        expect(byContent.get('B')?.parentId).toBe(byContent.get('A')!.id);
    });

    it('reads a tab-indented checkbox under a heading as code, and puts the line past it (Obsidian, measurement.md q10)', async () => {
        // Four columns at the top of a section with no paragraph to go on is
        // indented code; below `- [ ] N` the same line would be N's child
        // item, so N goes past it (P1), and the code stays code.
        const session = await open(['## Tasks', '\t- [ ] A', '\t\t- [ ] B', ''].join('\n'));
        expect(idByText(session).size).toBe(0);

        await session.index.createTask(FILE, '- [ ] N', 'Tasks');
        await session.settle(FILE);

        expect(contents.get(FILE)!.split('\n')).toEqual(['## Tasks', '\t- [ ] A', '\t\t- [ ] B', '- [ ] N', '']);
        const tasks = session.index.getTasks().filter(task => task.file === FILE);
        expect(tasks.map(task => task.content)).toEqual(['N']);
    });

    it('is refused when the heading is absent and the note ends in a fence that never closes (B5)', async () => {
        const text = ['- [ ] A', '```', 'code', ''].join('\n');
        const session = await open(text);
        const refused = watchRefusals(session);

        const line = await session.index.createTask(FILE, '- [ ] N', 'Tasks');

        expect(line).toBe(null);
        expect(contents.get(FILE)!).toBe(text);
        // Told in the words of the task it would have made, not the heading's.
        expect(refused.map(r => [r.reason.kind, r.subject])).toEqual([['unplaceable', '- [ ] N']]);
    });
});

describe('a key set in the frontmatter', () => {
    it('keeps the names of the rows below it, and the scan adopts its claim', async () => {
        const session = await open(['---', 'title: x', '---', '- [ ] A', '- [ ] A', '- [ ] B', ''].join('\n'));
        const before = session.index.getTasks().sort((a, b) => a.line - b.line).map(task => task.id);
        const claims = watchClaims(session);

        await session.index.getRepository().setFrontmatterKeys(FILE, { 'tv-color': 'ff0000' });
        await session.settle(FILE);

        expect(contents.get(FILE)!.split('\n').slice(0, 4)).toEqual(['---', 'title: x', 'tv-color: ff0000', '---']);
        const after = session.index.getTasks().sort((a, b) => a.line - b.line).map(task => task.id);
        expect(after).toEqual(before);
        expect(claims.adopted).toEqual([FILE]);
    });
});
