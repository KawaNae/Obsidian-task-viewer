import { describe, it, expect, vi } from 'vitest';
import { TFolder } from 'obsidian';
import { NoteName, type NoteVault } from '../../../src/services/data/NoteName';
import { makeFile } from '../helpers/vaultSession';

/** A vault of these notes, and of the folders they are in and `folders` besides. */
function vaultOf(paths: string[], folders: string[] = []): NoteVault {
    const files = paths.map(makeFile);
    const all = new Set(folders);
    for (const path of paths) {
        const parts = path.split('/').slice(0, -1);
        parts.forEach((_, i) => all.add(parts.slice(0, i + 1).join('/')));
    }
    const folderObjs = [...all].map(path => Object.assign(new TFolder(), { path, name: path.split('/').pop() }));
    return {
        getFiles: () => files,
        getMarkdownFiles: () => files.filter(f => f.extension === 'md'),
        getAllFolders: () => folderObjs,
    } as unknown as NoteVault;
}

describe('NoteName.fromText: the name a row suggests', () => {
    it.each([
        ['設計書を書く #work @2026-09-30 ^abc', '設計書を書く'],
        ['設計書を書く', '設計書を書く'],
        ['#work 設計書  を書く', '設計書 を書く'],
        ['[[報告書|レポート]] を読む', 'レポート を読む'],
        ['[[報告書]] を読む', '報告書 を読む'],
        ['[表示](path/to.md) を読む', '表示 を読む'],
        ['a/b\\c: d|e [f] g^h #i', 'abc de f gh'],
        ['..隠す', '隠す'],
        ['#only #tags', ''],
    ])('%j → %j', (text, name) => {
        expect(NoteName.fromText(text)).toBe(name);
    });

    it('suggests a name the check accepts, or none', () => {
        for (const text of ['a/b', 'x#y', 'C# 入門', '"quoted" <tag>?', '*star*']) {
            const name = NoteName.fromText(text);
            if (name !== '') expect(NoteName.check(name)).toEqual({ ok: true });
        }
    });
});

describe('NoteName.linksIn: the notes a row links to', () => {
    it('each as its link spells the note, without heading, block or shown text', () => {
        expect(NoteName.linksIn('読む [[Plan]] と [[a/b#h|B]] と ![[c#^x]]')).toEqual(['Plan', 'a/b', 'c']);
    });

    it('a Markdown link to a path in the vault, decoded; not a URL', () => {
        expect(NoteName.linksIn('[計画](Projects/My%20Plan.md#h) [web](https://example.com) [x](<a b.md>)')).toEqual(['Projects/My Plan.md', 'a b.md']);
    });

    it('not a link into its own note', () => {
        expect(NoteName.linksIn('見る [[#Done]] [[#^id]] [t](#h)')).toEqual([]);
    });
});

describe('NoteName.check: whether a name can be a note\'s', () => {
    it('takes a name of words', () => {
        expect(NoteName.check('設計書を書く')).toEqual({ ok: true });
        expect(NoteName.check(' with space ')).toEqual({ ok: true });
    });

    it('refuses an empty name', () => {
        expect(NoteName.check('')).toEqual({ ok: false, why: 'empty' });
        expect(NoteName.check('   ')).toEqual({ ok: false, why: 'empty' });
    });

    it.each(['/', '\\', ':', '#', '^', '[', ']', '|', '*', '"', '<', '>', '?'])('refuses a name holding %s', (char) => {
        expect(NoteName.check(`a${char}b`)).toEqual({ ok: false, why: 'chars', chars: char });
    });

    it('names each character it cannot hold, once', () => {
        expect(NoteName.check('a|b|c#d')).toEqual({ ok: false, why: 'chars', chars: '|#' });
    });

    it('refuses a name that opens with a dot', () => {
        expect(NoteName.check('.hidden')).toEqual({ ok: false, why: 'dot' });
    });
});

describe('NoteName: a name typed with .md', () => {
    it('is the name without it, in any case', () => {
        const vault = vaultOf(['Inbox/報告書.md']);
        expect(NoteName.at(vault, 'Inbox', '報告書.md')).toMatchObject({ kind: 'existing' });
        expect(NoteName.at(vault, 'Inbox', '報告書.MD ')).toMatchObject({ kind: 'existing' });
        expect(NoteName.at(vault, '', '新しい.Md')).toEqual({ kind: 'new', path: '新しい.md', namesakes: [] });
    });

    it('drops it once: a name that is more than .md keeps the rest', () => {
        expect(NoteName.at(vaultOf([]), '', 'a.md.md')).toMatchObject({ kind: 'new', path: 'a.md.md' });
        expect(NoteName.at(vaultOf([]), '', 'v1.2')).toMatchObject({ kind: 'new', path: 'v1.2.md' });
    });

    it('is checked without it: .md alone is an empty name', () => {
        expect(NoteName.check('報告書.md')).toEqual({ ok: true });
        expect(NoteName.check('.md')).toEqual({ ok: false, why: 'empty' });
        expect(NoteName.check(' .MD ')).toEqual({ ok: false, why: 'empty' });
    });
});

describe('NoteName.defaultFolder: where a new note goes by the settings', () => {
    it('is the folder Obsidian answers for a new note beside the row\'s', () => {
        const getNewFileParent = vi.fn(() => Object.assign(new TFolder(), { path: 'Inbox' }));
        expect(NoteName.defaultFolder({ fileManager: { getNewFileParent } } as never, 'Daily/2026-09-28.md')).toBe('Inbox');
        expect(getNewFileParent).toHaveBeenCalledWith('Daily/2026-09-28.md');
    });

    it('is \'\' for the root, which Obsidian calls /', () => {
        const getNewFileParent = () => Object.assign(new TFolder(), { path: '/' });
        expect(NoteName.defaultFolder({ fileManager: { getNewFileParent } } as never, 'a.md')).toBe('');
    });
});

describe('NoteName.at: the note a name and a folder point at', () => {
    it('a path no note is at: a new note there', () => {
        expect(NoteName.at(vaultOf(['Inbox/other.md']), 'Inbox', '報告書')).toEqual({ kind: 'new', path: 'Inbox/報告書.md', namesakes: [] });
    });

    it('the root is the folder \'\'', () => {
        expect(NoteName.at(vaultOf([]), '', '報告書')).toEqual({ kind: 'new', path: '報告書.md', namesakes: [] });
    });

    it('a note at the path: that note', () => {
        const vault = vaultOf(['Inbox/報告書.md']);
        const at = NoteName.at(vault, 'Inbox', '報告書');
        expect(at.kind).toBe('existing');
        expect(at.kind === 'existing' && at.file).toBe(vault.getFiles()[0]);
    });

    it.each([
        ['the name', 'A', 'note'],
        ['the folder', 'a', 'Note'],
        ['both', 'a', 'NOTE'],
    ])('a note whose path differs in the case of %s alone: that note, as the vault spells it', (_what, folder, name) => {
        const vault = vaultOf(['A/Note.md']);
        const at = NoteName.at(vault, folder, name);
        expect(at.kind).toBe('existing');
        expect(at.kind === 'existing' && at.file.path).toBe('A/Note.md');
    });

    it('prefers the note spelt as asked over one that differs in case', () => {
        const vault = vaultOf(['A/note.md', 'A/Note.md']);
        const at = NoteName.at(vault, 'A', 'Note');
        expect(at.kind === 'existing' && at.file.path).toBe('A/Note.md');
    });

    it('a new note goes into the folder there is, spelt as the vault spells it', () => {
        expect(NoteName.at(vaultOf(['Projects/Web/x.md']), 'projects/web/new', 'N')).toEqual({ kind: 'new', path: 'Projects/Web/new/N.md', namesakes: [] });
        expect(NoteName.at(vaultOf([], ['Empty']), 'empty', 'N')).toEqual({ kind: 'new', path: 'Empty/N.md', namesakes: [] });
    });

    it('names the notes of the same name in other folders', () => {
        const vault = vaultOf(['d1/Dup.md', 'd2/dup.md', 'd2/Other.md']);
        const fresh = NoteName.at(vault, 'd3', 'Dup');
        expect(fresh.kind).toBe('new');
        expect(fresh.namesakes.map(f => f.path)).toEqual(['d1/Dup.md', 'd2/dup.md']);
        const there = NoteName.at(vault, 'd1', 'Dup');
        expect(there.kind).toBe('existing');
        expect(there.namesakes.map(f => f.path)).toEqual(['d2/dup.md']);
    });
});
