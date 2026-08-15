import { describe, it, expect } from 'vitest';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { TaskStore } from '../../../src/services/core/TaskStore';
import { DEFAULT_SETTINGS } from '../../../src/types';

const parse = (lines: string[], frontmatter?: Record<string, any>) =>
    FileParsePipeline.parse('note.md', lines, frontmatter, DEFAULT_SETTINGS);

describe('FileParsePipeline — generation blocks', () => {
    it('carries the blocks of the file', () => {
        const result = parse([
            '- [ ] 週報 @2026-08-17 ==> every mon',
            '',
            '```tv-gen 週報の手順',
            '- [ ] 資料集め',
            '```',
        ]);
        expect([...result.genBlocks.keys()]).toEqual(['週報の手順']);
        expect(result.genBlocks.get('週報の手順')!.body).toEqual(['- [ ] 資料集め']);
    });

    it('does not turn the block body into tasks', () => {
        const result = parse([
            '```tv-gen 手順',
            '- [ ] 資料集め @2026-08-20',
            '```',
        ]);
        expect(result.tasks).toEqual([]);
    });

    it('produces no blocks for a tv-ignore file', () => {
        const result = parse([
            '```tv-gen 手順',
            '- [ ] 資料集め',
            '```',
        ], { 'tv-ignore': true });
        expect(result.ignored).toBe(true);
        expect(result.genBlocks.size).toBe(0);
    });
});

describe('TaskStore — generation blocks', () => {
    const block = (name: string) => ({ name, body: ['- [ ] a'], openLine: 0, closeLine: 2 });

    it('resolves a block by file and name', () => {
        const store = new TaskStore(DEFAULT_SETTINGS);
        store.setGenBlocks('a.md', new Map([['手順', block('手順')]]));
        expect(store.getGenBlock('a.md', '手順')!.body).toEqual(['- [ ] a']);
    });

    it('keeps resolution file-local', () => {
        const store = new TaskStore(DEFAULT_SETTINGS);
        store.setGenBlocks('a.md', new Map([['手順', block('手順')]]));
        expect(store.getGenBlock('b.md', '手順')).toBeUndefined();
    });

    it('replaces a file’s blocks rather than merging them', () => {
        const store = new TaskStore(DEFAULT_SETTINGS);
        store.setGenBlocks('a.md', new Map([['古い', block('古い')]]));
        store.setGenBlocks('a.md', new Map([['新しい', block('新しい')]]));
        expect([...store.getGenBlocks('a.md').keys()]).toEqual(['新しい']);
    });

    it('forgets the blocks of a removed file, even when it had no tasks', () => {
        const store = new TaskStore(DEFAULT_SETTINGS);
        store.setGenBlocks('a.md', new Map([['手順', block('手順')]]));
        store.removeTasksByFile('a.md');
        expect(store.getGenBlocks('a.md').size).toBe(0);
    });

    it('bumps the revision when only blocks were dropped', () => {
        const store = new TaskStore(DEFAULT_SETTINGS);
        store.setGenBlocks('a.md', new Map([['手順', block('手順')]]));
        const before = store.getRevision();
        store.removeTasksByFile('a.md');
        expect(store.getRevision()).toBeGreaterThan(before);
    });
});
