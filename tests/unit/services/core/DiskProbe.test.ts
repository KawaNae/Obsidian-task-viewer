import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as nodePath from 'path';
import type { DataAdapter, FileSystemAdapter } from 'obsidian';
import { AdapterDiskProbe, NodeDiskProbe, wholeMs } from '../../../../src/services/core/DiskProbe';
import type { NodeFs } from '../../../../src/utils/hostEnv';

/**
 * What the reconciler asks of the disk (`DiskProbe`): a file there, no file
 * there (null), or no answer (left out). Only the disk's own "not there"
 * takes a note out of the index: a busy or locked file (EBUSY on Windows) is
 * not known to be gone.
 */

let base: string;
beforeAll(() => {
    base = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'tv-probe-'));
    fs.mkdirSync(nodePath.join(base, 'notes/deep'), { recursive: true });
    fs.writeFileSync(nodePath.join(base, 'top.md'), '- [ ] A\n');
    fs.writeFileSync(nodePath.join(base, 'notes/deep/b.md'), 'text');
});
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

function adapterAt(root: string): FileSystemAdapter {
    return {
        getFullPath: (path: string) => nodePath.join(root, path),
    } as unknown as FileSystemAdapter;
}

/** Node's `fs`, whose `stat` throws `code` for the paths `failing` names. */
function fsFailing(code: string, failing: string): NodeFs {
    return {
        promises: {
            stat: async (path: string) => {
                if (path.endsWith(failing)) throw Object.assign(new Error(code), { code });
                return fs.promises.stat(path);
            },
        },
    };
}

describe('NodeDiskProbe', () => {
    it('stats a note as Obsidian keeps it: the whole millisecond nearest, and the size', async () => {
        const probe = new NodeDiskProbe(adapterAt(base), fs as unknown as NodeFs);
        const stat = fs.statSync(nodePath.join(base, 'top.md'));

        const answered = await probe.stat(['top.md']);

        expect(answered.get('top.md')).toEqual({ mtime: Math.round(stat.mtimeMs), size: 8 });
    });

    it('says a path with no file (ENOENT), or under a file (ENOTDIR), is gone', async () => {
        const probe = new NodeDiskProbe(adapterAt(base), fs as unknown as NodeFs);

        const answered = await probe.stat(['missing.md', 'top.md/under.md']);

        expect(answered.get('missing.md')).toBeNull();
        expect(answered.get('top.md/under.md')).toBeNull();
    });

    it.each(['EBUSY', 'EACCES', 'EMFILE'])('leaves out a path it could not stat for %s: not known to be gone', async (code) => {
        const probe = new NodeDiskProbe(adapterAt(base), fsFailing(code, 'top.md'));

        const answered = await probe.stat(['top.md', 'notes/deep/b.md']);

        expect(answered.has('top.md')).toBe(false);
        expect(answered.get('notes/deep/b.md')).not.toBeNull();
    });
});

describe('AdapterDiskProbe', () => {
    function adapterAnswering(answers: Record<string, unknown>): DataAdapter {
        return {
            stat: async (path: string) => {
                const answer = answers[path];
                if (answer instanceof Error) throw answer;
                return answer ?? null;
            },
        } as unknown as DataAdapter;
    }

    it('stats a file, says no file or a folder is gone, and leaves out a path it could not ask', async () => {
        const probe = new AdapterDiskProbe(adapterAnswering({
            'a.md': { type: 'file', mtime: 12, size: 3, ctime: 1 },
            'folder.md': { type: 'folder', mtime: 1, size: 0, ctime: 1 },
            'busy.md': new Error('busy'),
        }));

        const answered = await probe.stat(['a.md', 'none.md', 'folder.md', 'busy.md']);

        expect(answered.get('a.md')).toEqual({ mtime: 12, size: 3 });
        expect(answered.get('none.md')).toBeNull();
        expect(answered.get('folder.md')).toBeNull();
        expect(answered.has('busy.md')).toBe(false);
    });
});

describe('wholeMs', () => {
    it('rounds to the nearest millisecond, as `TFile.stat.mtime` has it', () => {
        expect(wholeMs(1759065048123.4)).toBe(1759065048123);
        expect(wholeMs(1759065048123.5)).toBe(1759065048124);
        expect(wholeMs(1759065048123)).toBe(1759065048123);
    });
});
