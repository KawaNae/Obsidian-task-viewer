import { describe, it, expect, afterEach } from 'vitest';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import type { Refusal } from '../../../src/utils/FileLines';
import { plannedOn } from '../../../src/services/persistence/TaskRefs';

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
    contents = new Map([[FILE, text]]);
    live = vaultSession(contents);
    await live.scanAll();
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
    const resolve = (observer as unknown as { resolve: (file: string) => { refused: (r: Refusal) => void } }).resolve;
    observer.connect(file => {
        const channel = resolve(file);
        return { ...channel, refused: (refusal: Refusal) => { refused.push(refusal); channel.refused(refusal); } } as never;
    });
    return refused;
}

describe('a line put under a heading', () => {
    it('keeps the names of the indented tasks directly under the heading (F4, F6)', async () => {
        const session = await open(['## Tasks', '\t- [ ] A', '\t\t- [ ] B', ''].join('\n'));
        const before = idByText(session);
        const claims = watchClaims(session);

        await session.index.createTask(FILE, '- [ ] N', 'Tasks');
        await session.settle(FILE);

        expect(contents.get(FILE)!.split('\n')).toEqual(['## Tasks', '- [ ] N', '\t- [ ] A', '\t\t- [ ] B', '']);
        const after = idByText(session);
        expect(after.get('- [ ] A')).toBe(before.get('- [ ] A'));
        expect(after.get('- [ ] B')).toBe(before.get('- [ ] B'));
        expect(claims.adopted).toEqual([FILE]);
    });

    it('is refused when the heading is absent and the note ends in a fence that never closes (B5)', async () => {
        const text = ['- [ ] A', '```', 'code', ''].join('\n');
        const session = await open(text);
        const refused = watchRefusals(session);

        const line = await session.index.createTask(FILE, '- [ ] N', 'Tasks');

        expect(line).toBe(null);
        expect(contents.get(FILE)!).toBe(text);
        expect(refused.map(r => r.reason.kind)).toEqual(['unplaceable']);
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

    it('leaves a record the next write builds its claim on, before any scan', async () => {
        // F1's regression: after an unreported write the ledger no longer fit
        // the file, so the next write could claim nothing until a scan came.
        const session = await open(['- [ ] A', '- [ ] B', ''].join('\n'));
        const claims = watchClaims(session);
        const [a] = session.index.getTasks().sort((x, y) => x.line - y.line);

        session.index.setDraggingFile(FILE); // hold the scans off
        await session.index.getRepository().setFrontmatterKeys(FILE, { 'tv-color': 'ff0000' });
        expect((await session.index.getRepository().updateTaskInFile(plannedOn(a), { ...a, statusChar: 'x' })).written).toBe(true);
        expect(claims.filed).toEqual([FILE, FILE]);
    });
});
