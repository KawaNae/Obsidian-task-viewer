import { describe, it, expect, afterEach } from 'vitest';
import { openVault, type VaultSession } from '../helpers/vaultSession';

/**
 * Whether a note has rows at all hangs on a frontmatter key (`tv-ignore`),
 * and so does what every row inherits (dates). A write's record, a write's
 * `locate` and the scan that follows read the key off the lines they hold
 * (F5b), not out of metadataCache,
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

/** How many claims the scans adopted, counted on the log (see HeadingAndFrontmatterClaims). */
function watchAdoptions(session: VaultSession): { adopted: number } {
    const log = session.scanner.getHintLog() as unknown as { settle: (file: string, consumed: number) => void };
    const seen = { adopted: 0 };
    const settle = log.settle.bind(log);
    log.settle = (file, consumed) => {
        if (consumed > 0) seen.adopted++;
        settle(file, consumed);
    };
    return seen;
}

describe('a write that lifts tv-ignore', () => {
    it('the record reads the note as tasks, and the scan adopts it', async () => {
        const session = await open(['---', 'tv-ignore: true', '---', '- [ ] A @2026-09-21', '']);
        expect(idsByText(session).size).toBe(0);
        const seen = watchAdoptions(session);

        await session.index.getRepository().setFrontmatterKeys(FILE, { 'tv-ignore': null });
        await session.settle(FILE);

        expect(idsByText(session).has('- [ ] A @2026-09-21')).toBe(true);
        expect(seen.adopted).toBe(1);
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
