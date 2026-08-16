import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { TaskCloner, type GeneratedChild } from '../../../src/services/persistence/TaskCloner';
import { FileOperations } from '../../../src/services/persistence/utils/FileOperations';
import { makeTask } from '../helpers/makeTask';
import type { Task } from '../../../src/types';

/**
 * Writing the next instance from what a gen block produced.
 *
 * The caller hands over finished values — a composed parent line, canonical
 * flow child lines, and children as depth and body. This layer owns two
 * decisions: where the lines go, and what one level of indentation looks like
 * in the file being written.
 */

const FILE = 'note.md';
const PARENT = '- [ ] 週報 第4回 @2026-08-24';
const FLOW = ['every mon', 'use("週報")'];

function harness(initial: string) {
    let content = initial;
    const file = new TFile();
    const app = {
        vault: {
            getAbstractFileByPath: () => file,
            process: async (_f: TFile, fn: (data: string) => string) => { content = fn(content); },
        },
    } as any;
    return {
        cloner: new TaskCloner(app, new FileOperations(app)),
        lines: () => content.split('\n'),
    };
}

const fired = (overrides: Partial<Task> = {}) => makeTask({
    content: '週報 第3回', file: FILE, line: 0,
    originalText: '- [ ] 週報 第3回 @2026-08-17', startDate: '2026-08-17',
    ...overrides,
});

const child = (depth: number, body: string): GeneratedChild => ({ depth, body });

describe('insertGeneratedInstance places the generated lines', () => {
    it('writes parent, flow lines and children in that order', async () => {
        const h = harness('- [ ] 週報 第3回 @2026-08-17');

        await h.cloner.insertGeneratedInstance(fired(), PARENT, FLOW, [
            child(1, '- [ ] 資料集め'),
            child(1, '- [ ] 下書き'),
        ]);

        expect(h.lines()).toEqual([
            PARENT,
            '\t- ==> every mon',
            '\t- ==> use("週報")',
            '\t- [ ] 資料集め',
            '\t- [ ] 下書き',
            '- [ ] 週報 第3回 @2026-08-17',
        ]);
    });

    it('gives the parent the fired task\'s own indent', async () => {
        const h = harness([
            '- [ ] 親',
            '\t- [ ] 週報 第3回 @2026-08-17',
        ].join('\n'));

        await h.cloner.insertGeneratedInstance(
            fired({ line: 1, originalText: '\t- [ ] 週報 第3回 @2026-08-17' }),
            PARENT, [], [child(1, '- [ ] 資料集め')]
        );

        expect(h.lines()[1]).toBe('\t' + PARENT);
        expect(h.lines()[2]).toBe('\t\t- [ ] 資料集め');
    });

    it('nests deeper children one unit per level', async () => {
        const h = harness('- [ ] 週報 第3回 @2026-08-17');

        await h.cloner.insertGeneratedInstance(fired(), PARENT, [], [
            child(1, '- [ ] 章立て'),
            child(2, '- [ ] 序'),
            child(3, '- [ ] 注記'),
            child(1, '- [ ] 校正'),
        ]);

        expect(h.lines().slice(1, 5)).toEqual([
            '\t- [ ] 章立て',
            '\t\t- [ ] 序',
            '\t\t\t- [ ] 注記',
            '\t- [ ] 校正',
        ]);
    });

    it('lands at the head of the sibling group', async () => {
        const h = harness([
            '- [ ] 先に書かれた別のタスク @2026-08-10',
            '- [ ] 週報 第3回 @2026-08-17',
        ].join('\n'));

        await h.cloner.insertGeneratedInstance(
            fired({ line: 1 }), PARENT, [], []
        );

        expect(h.lines()[0]).toBe(PARENT);
    });
});

describe('insertGeneratedInstance resolves the indent unit from the file', () => {
    it('follows the fired task\'s existing children', async () => {
        const h = harness([
            '- [ ] 週報 第3回 @2026-08-17',
            '    - [x] ⏱️ 記録',
        ].join('\n'));

        await h.cloner.insertGeneratedInstance(fired(), PARENT, ['every mon'], [
            child(1, '- [ ] 資料集め'),
        ]);

        expect(h.lines().slice(0, 3)).toEqual([
            PARENT,
            '    - ==> every mon',
            '    - [ ] 資料集め',
        ]);
    });

    it('falls back to how the rest of the file is written', async () => {
        const h = harness([
            '- [ ] 週報 第3回 @2026-08-17',
            '- [ ] 別のタスク',
            '    - [ ] その子',
        ].join('\n'));

        await h.cloner.insertGeneratedInstance(fired(), PARENT, [], [
            child(1, '- [ ] 資料集め'),
        ]);

        expect(h.lines()[1]).toBe('    - [ ] 資料集め');
    });

    it('uses a tab when the file has no indentation to read', async () => {
        const h = harness('- [ ] 週報 第3回 @2026-08-17');

        await h.cloner.insertGeneratedInstance(fired(), PARENT, [], [
            child(1, '- [ ] 資料集め'),
        ]);

        expect(h.lines()[1]).toBe('\t- [ ] 資料集め');
    });

    it('ignores indentation the caller put on the values', async () => {
        const h = harness('- [ ] 週報 第3回 @2026-08-17');

        await h.cloner.insertGeneratedInstance(
            fired(), '        ' + PARENT, [], [child(1, '        - [ ] 資料集め')]
        );

        expect(h.lines()[0]).toBe(PARENT);
        expect(h.lines()[1]).toBe('\t- [ ] 資料集め');
    });

    it('treats a depth below one as the first level', async () => {
        // A children-only block starts its children at depth 1, but a caller
        // that hands over 0 must not produce a second line at parent depth.
        const h = harness('- [ ] 週報 第3回 @2026-08-17');

        await h.cloner.insertGeneratedInstance(fired(), PARENT, [], [child(0, '- [ ] 資料集め')]);

        expect(h.lines()[1]).toBe('\t- [ ] 資料集め');
    });
});

describe('insertGeneratedInstance writes nothing it cannot place', () => {
    it('leaves the file alone when the fired task cannot be resolved', async () => {
        const before = '- [ ] 別のタスク @2026-08-17';
        const h = harness(before);

        await h.cloner.insertGeneratedInstance(
            fired({ originalText: '- [ ] 消えたタスク @stale', line: 5 }),
            PARENT, FLOW, [child(1, '- [ ] 資料集め')]
        );

        expect(h.lines()).toEqual([before]);
    });

    it('writes only the parent when there is nothing else', async () => {
        const h = harness('- [ ] 週報 第3回 @2026-08-17');

        await h.cloner.insertGeneratedInstance(fired(), PARENT, [], []);

        expect(h.lines()).toEqual([PARENT, '- [ ] 週報 第3回 @2026-08-17']);
    });
});
