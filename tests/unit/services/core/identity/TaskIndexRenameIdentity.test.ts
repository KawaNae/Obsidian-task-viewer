import { describe, it, expect, afterEach } from 'vitest';
import { TFile } from 'obsidian';
import { TaskIndex } from '../../../../../src/services/core/TaskIndex';
import type { TaskScanner } from '../../../../../src/services/core/TaskScanner';
import { TaskIdGenerator } from '../../../../../src/services/display/TaskIdGenerator';
import { DEFAULT_SETTINGS } from '../../../../../src/types';

/**
 * The order TaskIndex runs a rename in, pinned from the outside.
 *
 * The ledger has to be re-keyed to the new path *before* the new path is
 * scanned: the other way round, the scan meets an empty ledger, every task in
 * the file is minted afresh, and every open hub and running timer loses its
 * target at once. Nothing in the scanner can enforce that — only the handler's
 * order can — so it is tested through the handler Obsidian actually calls.
 */

type Handler = (...args: unknown[]) => unknown;

class FakeEmitter {
    readonly handlers = new Map<string, Handler>();

    on(name: string, fn: Handler): unknown {
        this.handlers.set(name, fn);
        return { name };
    }

    offref(_ref: unknown): void { }

    fire(name: string, ...args: unknown[]): unknown {
        const handler = this.handlers.get(name);
        if (!handler) throw new Error(`no handler for ${name}`);
        return handler(...args);
    }
}

function makeFile(path: string): TFile {
    const file = new TFile();
    file.path = path;
    file.name = path.split('/').pop() ?? path;
    file.basename = file.name.replace(/\.md$/, '');
    file.extension = path.split('.').pop() ?? '';
    return file;
}

function setup() {
    const contents = new Map<string, string>();
    const vault = new FakeEmitter();
    const metadataCache = new FakeEmitter();
    const workspace = new FakeEmitter();
    const app = {
        vault: Object.assign(vault, {
            read: async (file: TFile) => contents.get(file.path) ?? '',
            getAbstractFileByPath: () => null,
            getMarkdownFiles: () => [],
        }),
        metadataCache: Object.assign(metadataCache, { getCache: () => null }),
        workspace: Object.assign(workspace, { onLayoutReady: () => { }, activeLeaf: null }),
    };
    const index = new TaskIndex(app as never, { ...DEFAULT_SETTINGS });
    const scanner = (index as unknown as { scanner: TaskScanner }).scanner;
    scanner.setInitializing(false);
    return { contents, vault, index, scanner };
}

let dispose: (() => void) | undefined;
afterEach(() => {
    dispose?.();
    dispose = undefined;
});

describe('TaskIndex rename and delete keep the ledger in step', () => {
    it('an md → md rename carries every ID over to the new path', async () => {
        const { contents, vault, index, scanner } = setup();
        dispose = () => index.dispose();
        await index.initialize();

        contents.set('old.md', ['- [ ] P @2026-09-21', '    - [ ] c @2026-09-21'].join('\n'));
        await scanner.requestScan(makeFile('old.md'));
        const before = index.getTasks().map(task => task.id).sort();
        expect(before).toHaveLength(2);

        contents.set('new.md', contents.get('old.md')!);
        contents.delete('old.md');
        await vault.fire('rename', makeFile('new.md'), 'old.md');

        const after = index.getTasks().map(task => task.id).sort();
        expect(after).toEqual(before.map(id => TaskIdGenerator.renameFile(id, 'old.md', 'new.md')).sort());
        expect(scanner.getLedger().snapshotFor('old.md')).toEqual([]);
    });

    it('a delete drops the file from the ledger', async () => {
        const { contents, vault, index, scanner } = setup();
        dispose = () => index.dispose();
        await index.initialize();

        contents.set('a.md', '- [ ] A @2026-09-21');
        await scanner.requestScan(makeFile('a.md'));
        expect(scanner.getLedger().snapshotFor('a.md')).toHaveLength(1);

        contents.delete('a.md');
        vault.fire('delete', makeFile('a.md'));

        expect(scanner.getLedger().snapshotFor('a.md')).toEqual([]);
        expect(index.getTasks()).toEqual([]);
    });

    it('an md → non-md rename drops the file from the ledger', async () => {
        const { contents, vault, index, scanner } = setup();
        dispose = () => index.dispose();
        await index.initialize();

        contents.set('a.md', '- [ ] A @2026-09-21');
        await scanner.requestScan(makeFile('a.md'));

        await vault.fire('rename', makeFile('a.txt'), 'a.md');

        expect(scanner.getLedger().snapshotFor('a.md')).toEqual([]);
        expect(scanner.getLedger().snapshotFor('a.txt')).toEqual([]);
    });
});
