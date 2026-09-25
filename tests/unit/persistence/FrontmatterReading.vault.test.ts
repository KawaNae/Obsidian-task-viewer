import { describe, it, expect, afterEach } from 'vitest';
import { openVault, type VaultSession } from '../helpers/vaultSession';

/**
 * Whether a note has rows at all hangs on a frontmatter key (`tv-ignore`),
 * and so does what every row inherits (dates). The reading a write lands and
 * the scan that follows read the key off the lines they hold, not out of
 * metadataCache,
 * which describes the file at some other moment: inside the write it is the
 * file before the write, and at the scan a `modify` starts Obsidian may not
 * have re-read it yet.
 */

const FILE = 'note.md';

let live: VaultSession | undefined;
let contents = new Map<string, string>();
afterEach(() => {
    live?.dispose();
    live = undefined;
});

async function open(lines: string[]): Promise<VaultSession> {
    const opened = await openVault(lines);
    contents = opened.contents;
    live = opened.session;
    return live;
}

function idsByText(session: VaultSession): Map<string, string> {
    return new Map(session.index.getTasks()
        .filter(task => task.file === FILE)
        .map(task => [task.originalText.trim(), task.id]));
}

describe('a write that lifts tv-ignore', () => {
    it('lands a reading of the note as tasks, before any scan', async () => {
        const session = await open(['---', 'tv-ignore: true', '---', '- [ ] A @2026-09-21', '']);
        expect(idsByText(session).size).toBe(0);
        session.holdScans();

        await session.index.getRepository().setFrontmatterKeys(FILE, { 'tv-ignore': null });

        expect(idsByText(session).has('- [ ] A @2026-09-21')).toBe(true);
    });
});

describe('a scan whose metadataCache has not caught up', () => {
    it('reads the frontmatter the lines hold', async () => {
        const session = await open(['---', 'title: x', '---', '- [ ] A @2026-09-21', '']);
        // The cache still says what the note said before an edit lifted it.
        const cache = session.app.metadataCache as unknown as { getCache: (path: string) => unknown };
        const real = cache.getCache.bind(cache);
        cache.getCache = (path: string) => ({ ...(real(path) as object), frontmatter: { title: 'x', 'tv-ignore': true } });

        await session.scanAll();

        expect(idsByText(session).has('- [ ] A @2026-09-21')).toBe(true);
    });
});
