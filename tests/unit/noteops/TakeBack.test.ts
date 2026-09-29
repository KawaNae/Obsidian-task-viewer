import { describe, it, expect, vi } from 'vitest';
import { takeBack } from '../../../src/services/persistence/FileLines';
import { makeFile } from '../helpers/vaultSession';

/**
 * `takeBack` of what a write left: taken back only while the note reads as the
 * write left it, and otherwise left as it is, with the reason.
 */
function appWith(content: string | Error, there = true, trash: () => Promise<void> = async () => { }) {
    const file = makeFile('made.md');
    const trashFile = vi.fn(trash);
    const app = {
        vault: {
            getAbstractFileByPath: (path: string) => (there && path === file.path ? file : null),
            read: async () => { if (content instanceof Error) throw content; return content; },
        },
        fileManager: { trashFile },
    };
    return { app: app as never, file, trashFile };
}

describe('takeBack: a note a write made', () => {
    it('reads as the write left it: to the trash', async () => {
        const { app, file, trashFile } = appWith('');
        expect(await takeBack(app, file, undefined, [''], { kind: 'made' })).toEqual({ taken: true });
        expect(trashFile).toHaveBeenCalledWith(file);
    });

    it('the mark at its head and its line ends aside', async () => {
        const { app, file } = appWith('﻿a\r\nb');
        expect(await takeBack(app, file, undefined, ['a', 'b'], { kind: 'made' })).toEqual({ taken: true });
    });

    it('written since: left as it is', async () => {
        const { app, file, trashFile } = appWith('typed');
        expect(await takeBack(app, file, undefined, [''], { kind: 'made' })).toEqual({ taken: false, why: 'changed' });
        expect(trashFile).not.toHaveBeenCalled();
    });

    it('not there under its path: left as it is', async () => {
        const { app, file, trashFile } = appWith('', false);
        expect(await takeBack(app, file, undefined, [''], { kind: 'made' })).toEqual({ taken: false, why: 'gone' });
        expect(trashFile).not.toHaveBeenCalled();
    });

    it('a read or a trash that fails: failed', async () => {
        const unreadable = appWith(new Error('EIO'));
        expect(await takeBack(unreadable.app, unreadable.file, undefined, [''], { kind: 'made' })).toEqual({ taken: false, why: 'failed' });
        const stuck = appWith('', true, async () => { throw new Error('EPERM'); });
        expect(await takeBack(stuck.app, stuck.file, undefined, [''], { kind: 'made' })).toEqual({ taken: false, why: 'failed' });
    });
});

/** A note held in `content`, written through `vault.process` as Obsidian does, the channel hearing what landed. */
function noteWith(content: string) {
    const file = makeFile('dst.md');
    const held = { content };
    const landed: unknown[] = [];
    const app = {
        vault: {
            getAbstractFileByPath: (path: string) => (path === file.path ? file : null),
            read: async () => held.content,
            process: async (_f: unknown, fn: (data: string) => string) => { held.content = fn(held.content); return held.content; },
        },
    };
    const channel = {
        landed: (landing: unknown) => { landed.push(landing); },
        refused: vi.fn(),
        follow: () => null,
        reading: () => ({ n: 0, key: undefined }),
    };
    return { app: app as never, file, held, landed, channel };
}

describe('takeBack: lines a write put in a note there was', () => {
    it('removes the ranges named, from the bottom, and hands what it left on with its report', async () => {
        const { app, file, held, landed, channel } = noteWith('﻿## T\r\n- [ ] A\r\n- [ ] B\r\n    - [ ] b\r\n- [ ] C\r\n');
        const left = ['## T', '- [ ] A', '- [ ] B', '    - [ ] b', '- [ ] C', ''];

        expect(await takeBack(app, file, channel, left, { kind: 'remove', ranges: [[1, 2], [2, 4]] })).toEqual({ taken: true });
        expect(held.content).toBe('﻿## T\r\n- [ ] C\r\n');
        expect(landed).toHaveLength(1);
        expect((landed[0] as { edits: unknown[] }).edits).toHaveLength(2);
    });

    it('restores the lines it was handed, in the note\'s own line ends', async () => {
        const { app, file, held, landed, channel } = noteWith('---\r\nk: 1\r\nj: 2\r\n---\r\n- [ ] x\r\n## T\r\n- [ ] A\r\n');
        const left = ['---', 'k: 1', 'j: 2', '---', '- [ ] x', '## T', '- [ ] A', ''];

        expect(await takeBack(app, file, channel, left, { kind: 'restore', lines: ['---', 'k: 1', '---', '- [ ] x', ''] })).toEqual({ taken: true });
        expect(held.content).toBe('---\r\nk: 1\r\n---\r\n- [ ] x\r\n');
        expect((landed[0] as { edits: unknown }).edits).toBeNull();
    });

    it('written since: left as it is, and told to nobody', async () => {
        const { app, file, held, landed, channel } = noteWith('- [ ] A\n- [ ] typed\n');

        expect(await takeBack(app, file, channel, ['- [ ] A', ''], { kind: 'remove', ranges: [[0, 1]] })).toEqual({ taken: false, why: 'changed' });
        expect(await takeBack(app, file, channel, ['- [ ] A', ''], { kind: 'restore', lines: [''] })).toEqual({ taken: false, why: 'changed' });
        expect(held.content).toBe('- [ ] A\n- [ ] typed\n');
        expect(landed).toEqual([]);
        expect(channel.refused).not.toHaveBeenCalled();
    });

    it('a write that fails: failed, told to nobody', async () => {
        const { app, file, held, channel } = noteWith('- [ ] A\n');
        (app as { vault: { process: unknown } }).vault.process = async () => { throw new Error('EIO'); };

        expect(await takeBack(app, file, channel, ['- [ ] A', ''], { kind: 'restore', lines: [''] })).toEqual({ taken: false, why: 'failed' });
        expect(held.content).toBe('- [ ] A\n');
        expect(channel.refused).not.toHaveBeenCalled();
    });
});
