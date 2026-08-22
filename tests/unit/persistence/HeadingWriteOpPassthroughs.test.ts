import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { TaskRepository } from '../../../src/services/persistence/TaskRepository';

/**
 * 一本化した見出し挿入経路の配線を pin する。
 * ロジック自体（見出し挿入の中身）は HeadingInserter.test.ts 側でカバー済み
 * なので、ここでは「TaskRepository の呼び出しが正しい下請けに届くか」だけを見る。
 */

function heading_harness(initial: string) {
    let content = initial;
    const file = new TFile();
    const app = {
        vault: {
            getAbstractFileByPath: () => file,
            process: async (_f: TFile, fn: (data: string) => string) => { content = fn(content); },
        },
    } as any;
    return { repo: new TaskRepository(app), text: () => content };
}

describe('TaskRepository.insertLineUnderHeading', () => {
    it('delegates to the shared heading-write op and returns insertedLine', async () => {
        const h = heading_harness('## Tasks\nexisting');
        const insertedLine = await h.repo.insertLineUnderHeading('note.md', '- [ ] child', 'Tasks', 2);
        expect(insertedLine).toBe(1);
        expect(h.text().split('\n')[1]).toBe('- [ ] child');
    });
});
