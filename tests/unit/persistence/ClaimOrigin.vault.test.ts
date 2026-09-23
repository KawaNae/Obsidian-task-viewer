import { describe, it, expect, afterEach } from 'vitest';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import { plannedOn } from '../../../src/services/persistence/TaskRefs';
import type { Task } from '../../../src/types';

/**
 * A claim says whom its write was made for: the user or a flow (論点5). F5
 * fills the field in; F6 is to read it when it decides whether a completion
 * may fire. Pinned here per write path, because a path that files the wrong
 * one would make a flow's own write look like the user's, or the other way.
 */

const FILE = 'note.md';
const ARCHIVE = 'archive.md';

let live: VaultSession | undefined;
afterEach(() => {
    live?.dispose();
    live = undefined;
});

async function open(files: Record<string, string>): Promise<VaultSession> {
    live = vaultSession(new Map(Object.entries(files)));
    await live.scanAll();
    return live;
}

function task(session: VaultSession, text: string): Task {
    const found = session.index.getTasks().find(t => t.file === FILE && t.originalText.trim() === text);
    if (!found) throw new Error(`no task ${text}`);
    return found;
}

/** The origin of every record filed (a write that could say what it left), by file, in order. */
function watchOrigins(session: VaultSession): Array<[string, unknown]> {
    const claims = session.scanner.getWriteClaims();
    const seen: Array<[string, unknown]> = [];
    const claim = claims.claim.bind(claims);
    claims.claim = (file, before, after, edits, origin, named) => {
        const result = claim(file, before, after, edits, origin, named);
        if (result.described) seen.push([file, origin]);
        return result;
    };
    return seen;
}

describe('the origin a claim carries', () => {
    it('is the user for a card update, a delete, a duplicate, a created task and a frontmatter key', async () => {
        const session = await open({ [FILE]: '- [ ] A\n- [ ] B\n' });
        const seen = watchOrigins(session);

        const a = task(session, '- [ ] A');
        await session.index.updateTask(a.id, { statusChar: 'x' });
        await session.index.duplicateTask(task(session, '- [x] A').id);
        await session.index.deleteTask(task(session, '- [ ] B').id);
        await session.index.createTask(FILE, '- [ ] C');
        await session.index.createTask(FILE, '- [ ] D', 'Tasks');
        await session.index.getRepository().setFrontmatterKeys(FILE, { 'tv-color': 'ff0000' });

        expect(seen.length).toBe(6);
        expect(seen.every(([, origin]) => origin === 'user')).toBe(true);
    });

    it('is the user for the editor menu', async () => {
        const session = await open({ [FILE]: '- [ ] A\n' });
        const seen = watchOrigins(session);

        await session.index.updateLine(FILE, { line: 0, text: '- [ ] A' }, '- [x] A');

        expect(seen).toEqual([[FILE, 'user']]);
    });

    it('is a flow for a fire\'s write, and for both halves of a move to another note', async () => {
        const session = await open({ [FILE]: '- [ ] A\n- [ ] B\n', [ARCHIVE]: '' });
        const seen = watchOrigins(session);
        const repo = session.index.getRepository();

        const a = task(session, '- [ ] A');
        await repo.applyToTask(plannedOn(a), [{ kind: 'strip-flow', text: '- [x] A' }]);
        const b = task(session, '- [ ] B');
        const archived = await repo.appendTaskWithChildren(ARCHIVE, '- [x] B', plannedOn(b));
        expect(archived).not.toBeNull();

        expect(seen).toEqual([[FILE, 'flow'], [ARCHIVE, 'flow']]);
    });
});
