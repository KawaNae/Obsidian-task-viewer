import { describe, it, expect, vi } from 'vitest';
import { TFolder } from 'obsidian';
import { NoteName, type NoteAt, type NoteVault } from '../../../src/services/data/NoteName';
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
        for (const text of ['a/b', 'x#y', 'C# 入門', '"quoted" <tag>?', '*star*', 'a\\b']) {
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

    it('no link whose text holds a bracket, which no note name can', () => {
        expect(NoteName.linksIn('[[A]] [[a[b]]')).toEqual(['A']);
    });
});

describe('NoteName.check: whether a name or a path can be a new note\'s', () => {
    it('takes a name of words, and a path of them', () => {
        expect(NoteName.check('設計書を書く')).toEqual({ ok: true });
        expect(NoteName.check(' with space ')).toEqual({ ok: true });
        expect(NoteName.check('Projects/Web/設計')).toEqual({ ok: true });
        expect(NoteName.check('/Projects//設計.md')).toEqual({ ok: true });
    });

    it('refuses an empty name, and a path that ends in a folder', () => {
        expect(NoteName.check('')).toEqual({ ok: false, why: 'empty', at: 'name' });
        expect(NoteName.check('   ')).toEqual({ ok: false, why: 'empty', at: 'name' });
        expect(NoteName.check('Projects/')).toEqual({ ok: false, why: 'empty', at: 'name' });
    });

    it.each(['\\', ':', '#', '^', '[', ']', '|', '*', '"', '<', '>', '?'])('refuses a name holding %s, and a folder', (char) => {
        expect(NoteName.check(`a${char}b`)).toEqual({ ok: false, why: 'chars', chars: char, at: 'name' });
        expect(NoteName.check(`a${char}b/c`)).toEqual({ ok: false, why: 'chars', chars: char, at: 'folder' });
    });

    it('names each character it cannot hold, once; the name\'s before a folder\'s', () => {
        expect(NoteName.check('a|b|c#d')).toEqual({ ok: false, why: 'chars', chars: '|#', at: 'name' });
        expect(NoteName.check('x:/a?b')).toEqual({ ok: false, why: 'chars', chars: '?', at: 'name' });
    });

    it('refuses a name or a folder that opens with a dot', () => {
        expect(NoteName.check('.hidden')).toEqual({ ok: false, why: 'dot', at: 'name' });
        expect(NoteName.check('.trash/note')).toEqual({ ok: false, why: 'dot', at: 'folder' });
    });

    it('is checked without a .md at its end: .md alone is an empty name', () => {
        expect(NoteName.check('報告書.md')).toEqual({ ok: true });
        expect(NoteName.check('.md')).toEqual({ ok: false, why: 'empty', at: 'name' });
        expect(NoteName.check(' .MD ')).toEqual({ ok: false, why: 'empty', at: 'name' });
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

/** The note `text` points at, nothing picked, new notes going to `Inbox`. */
const find = (vault: NoteVault, text: string, picked: string | null = null) => NoteName.find(vault, { text, picked }, 'Inbox');
const pathOf = (at: NoteAt) => (at.kind === 'existing' ? at.file.path : at.kind === 'new' ? at.path : at.files.map(f => f.path));

describe('NoteName.find: a note picked', () => {
    it('is that note, whatever the text says, while the vault has it', () => {
        const vault = vaultOf(['a/同名.md', 'b/同名.md']);
        expect(pathOf(find(vault, '同名', 'b/同名.md'))).toBe('b/同名.md');
        expect(pathOf(find(vault, 'anything', 'a/同名.md'))).toBe('a/同名.md');
    });

    it('gone from the vault: the text is read on its own', () => {
        expect(find(vaultOf(['a/x.md']), 'x', 'gone.md')).toMatchObject({ kind: 'existing' });
    });
});

describe('NoteName.find: a name', () => {
    it('one note by the name, in any folder, case and normalization aside: that note', () => {
        const vault = vaultOf(['Projects/Web/Plan.md', 'Other.md', 'ガ.md']);
        expect(pathOf(find(vault, 'plan'))).toBe('Projects/Web/Plan.md');
        expect(pathOf(find(vault, ' PLAN.md '))).toBe('Projects/Web/Plan.md');
        expect(pathOf(find(vault, 'ガ'.normalize('NFD')))).toBe('ガ.md');
    });

    it('none: a new note in the folder for new notes, made by the name', () => {
        expect(find(vaultOf(['Inbox/x.md']), '報告書')).toEqual({ kind: 'new', path: 'Inbox/報告書.md', by: 'name', folderMade: null, namesakes: [] });
        expect(NoteName.find(vaultOf([]), { text: '報告書', picked: null }, '')).toMatchObject({ kind: 'new', path: '報告書.md', folderMade: null });
    });

    it('a .md typed once is the name\'s end; one that is more than .md keeps the rest', () => {
        expect(find(vaultOf([]), 'a.md.md')).toMatchObject({ kind: 'new', path: 'Inbox/a.md.md' });
        expect(find(vaultOf([]), 'v1.2')).toMatchObject({ kind: 'new', path: 'Inbox/v1.2.md' });
    });

    it('more than one note by the name: none of them, the notes by their paths', () => {
        const vault = vaultOf(['d2/dup.md', 'd1/Dup.md', 'd2/Other.md']);
        expect(find(vault, 'Dup')).toEqual({ kind: 'ambiguous', name: 'Dup', files: [vault.getMarkdownFiles()[1], vault.getMarkdownFiles()[0]] });
    });

    it('the folder for new notes not there yet: it is made with the note', () => {
        expect(find(vaultOf([]), 'n')).toMatchObject({ kind: 'new', path: 'Inbox/n.md', folderMade: 'Inbox' });
    });
});

describe('NoteName.find: a path', () => {
    it('read from the vault\'s root, a / at its start or twice in it as one', () => {
        const vault = vaultOf(['Projects/Plan.md']);
        expect(pathOf(find(vault, 'Projects/Plan'))).toBe('Projects/Plan.md');
        expect(pathOf(find(vault, '/projects//plan.md'))).toBe('Projects/Plan.md');
    });

    it('the note at the path from the root before one whose path ends in it', () => {
        const vault = vaultOf(['Archive/Projects/Plan.md', 'Projects/Plan.md']);
        expect(pathOf(find(vault, 'Projects/Plan'))).toBe('Projects/Plan.md');
    });

    it('prefers the note spelt as asked over one that differs in case', () => {
        const vault = vaultOf(['A/note.md', 'A/Note.md']);
        expect(pathOf(find(vault, 'A/Note'))).toBe('A/Note.md');
    });

    it('none at it from the root: the one note whose path ends in it, after a /', () => {
        const vault = vaultOf(['zz/b/同名.md', 'zz/a/同名.md', 'xb/同名.md']);
        expect(pathOf(find(vault, 'b/同名'))).toBe('zz/b/同名.md');
    });

    it('more than one whose path ends in it: none of them', () => {
        const vault = vaultOf(['x/b/同名.md', 'y/b/同名.md']);
        expect(find(vault, 'b/同名')).toMatchObject({ kind: 'ambiguous', name: 'b/同名' });
        expect(pathOf(find(vault, 'b/同名'))).toEqual(['x/b/同名.md', 'y/b/同名.md']);
    });

    it('none: a new note at the path, in the folders there are as the vault spells them, the first made named', () => {
        expect(find(vaultOf(['Projects/Web/x.md']), 'projects/web/new/N')).toEqual({ kind: 'new', path: 'Projects/Web/new/N.md', by: 'path', folderMade: 'Projects/Web/new', namesakes: [] });
        expect(find(vaultOf([], ['Empty']), 'empty/N')).toMatchObject({ kind: 'new', path: 'Empty/N.md', folderMade: null });
    });

    it('a new note names the notes by its name in other folders', () => {
        const vault = vaultOf(['d1/Dup.md', 'd2/dup.md', 'd2/Other.md']);
        const fresh = find(vault, 'd3/Dup');
        expect(fresh.kind === 'new' && fresh.namesakes.map(f => f.path)).toEqual(['d1/Dup.md', 'd2/dup.md']);
    });
});

describe('NoteName.fileAt: the note at a path as a send is made', () => {
    it('case aside, the one spelt as asked first; none where none is', () => {
        const vault = vaultOf(['A/note.md', 'A/Note.md']);
        expect(NoteName.fileAt(vault, 'A/Note.md')?.path).toBe('A/Note.md');
        expect(NoteName.fileAt(vault, 'a/NOTE.md')?.path).toBe('A/note.md');
        expect(NoteName.fileAt(vault, 'A/x.md')).toBeNull();
    });
});
