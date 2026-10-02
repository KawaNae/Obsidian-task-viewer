/**
 * A card is drawn whole when `TaskCardRenderer.render` returns, in the running
 * Dev vault. The draw does not wait on `MarkdownRenderer.render`: it rests on
 * Obsidian putting the markdown into the element within the call, which its
 * renderer does but its API does not promise. This test watches that.
 *
 * The hub is opened on a row and its preview read in the same task, without
 * yielding: the card's body, its children and their checkboxes must be there.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (path in dev-paths.mjs) open,
 *     with a build whose card draw is synchronous
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/card-sync.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { isObsidianRunning, obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';

const FILE = 'test-int-card-sync.md';

const NOTE = [
    '- [ ] 同期の親 @2026-09-29',
    '    - [ ] 同期の子a',
    '    - [x] 同期の子b',
    '    - メモの行',
    '',
].join('\n');

interface Preview {
    hub: boolean;
    content: string | null;
    boxes: number;
    childBoxes: boolean[];
}

function evalOrThrow<T>(code: string): T {
    const result = obsidianEval(code);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

/** Open the hub on the row whose text starts with `name`, and read its preview before yielding. */
function openAndRead(name: string): Preview {
    return evalOrThrow<Preview>(`(() => {
        const plugin = app.plugins.plugins['obsidian-task-viewer'];
        const task = plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(FILE)} && t.content.startsWith(${JSON.stringify(name)}));
        if (!task) throw new Error('no row ' + ${JSON.stringify(name)});
        plugin.openTaskHub(task.id);
        const content = document.querySelector('.task-hub .task-hub__preview .task-card__content');
        const boxes = content ? [...content.querySelectorAll('input[type="checkbox"]')] : [];
        return JSON.stringify({
            hub: !!document.querySelector('.task-hub'),
            content: content ? content.textContent : null,
            boxes: boxes.length,
            childBoxes: boxes.slice(1).map(b => b.checked),
        });
    })()`);
}

function closeHub(): void {
    obsidianEval(`(async () => {
        document.querySelector('.task-hub .tv-overlay__close')?.click();
        await new Promise(r => setTimeout(r, 300));
        return JSON.stringify(true);
    })()`);
}

beforeAll(async () => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
    expect(await writeIndexedTestFile(FILE, NOTE)).toBe(true);
});

afterEach(() => { closeHub(); });

afterAll(async () => {
    closeHub();
    deleteTestFile(FILE);
    await waitForFileDeindexed(FILE);
});

describe('a card drawn by TaskCardRenderer.render', () => {
    it('has its body, its children and their checkboxes when the draw returns', () => {
        const preview = openAndRead('同期の親');

        expect(preview.hub).toBe(true);
        expect(preview.content).toContain('同期の親');
        expect(preview.content).toContain('同期の子a');
        expect(preview.content).toContain('同期の子b');
        expect(preview.content).toContain('メモの行');
        expect(preview.boxes).toBe(3);
        expect(preview.childBoxes).toEqual([false, true]);
    });
});
