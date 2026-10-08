import { type App, type TFile, type TFolder, parseLinktext } from 'obsidian';
import { extractWikilinkTarget } from '../../utils/WikilinkUtils';
import { MARKDOWN_LINK_SOURCE, WIKILINK_SOURCE } from '../parsing/utils/InlineNotation';

/** What {@link NoteName} asks of the vault: its notes and its folders. */
export type NoteVault = Pick<App['vault'], 'getMarkdownFiles' | 'getAllFolders'>;

/**
 * The characters a note's name cannot hold: those a path or a file system
 * gives a meaning to (`/ \ :`, and `* " < > ?`, which Windows does not allow
 * in a file's name — the vault may be opened there), and those that end or
 * cut a link to the note (`# ^ [ ] |`).
 */
const UNUSABLE = /[/\\:*"<>?#^[\]|]/g;

/**
 * Whether a name or a path can be a new note's, and why not (see
 * {@link NoteName.check}): `at` says whether it is the note's name or a
 * folder on its path that cannot be one.
 */
export type NameCheck =
    | { ok: true }
    | { ok: false; why: 'empty'; at: 'name' }
    /** `chars`: each character it cannot hold, once, in the order it holds them. */
    | { ok: false; why: 'chars'; chars: string; at: 'name' | 'folder' }
    /** A name that opens with a dot names a note (or a folder) Obsidian does not show. */
    | { ok: false; why: 'dot'; at: 'name' | 'folder' };

/**
 * What the send dialog's note field holds: the text typed, and the note a
 * candidate picked from its list named, while the text is what the pick put
 * in (`note-suggest/send-field.md`).
 */
export interface NoteAsk {
    text: string;
    /** The path of the note picked; null when none was, or the text changed since. */
    picked: string | null;
}

/**
 * The note a note field points at (see {@link NoteName.find}): one of the
 * vault's; a path no note is at, where one is made; or more than one note,
 * which the field does not tell apart.
 */
export type NoteAt =
    /**
     * `file` may be spelt otherwise than the text asked, in its case: the
     * vault's own spelling, which is what the user is shown.
     */
    | { kind: 'existing'; file: TFile }
    /**
     * `by`: whether a name alone was typed (the note goes to the folder for
     * new notes) or a path. `folderMade`: the first folder on the path the
     * vault does not have, which the send makes with the note; null when
     * every one is there. `namesakes`: the vault's notes by the same name,
     * in other folders: a link to the note then has to name its path.
     */
    | { kind: 'new'; path: string; by: 'name' | 'path'; folderMade: string | null; namesakes: readonly TFile[] }
    /** `name`: the text as read. `files`: the notes it points at, by their paths. */
    | { kind: 'ambiguous'; name: string; files: readonly TFile[] };

/**
 * A note's name or path as typed: the spaces at its ends, and a `.md` at its
 * end in any case, left out. The note's name is without the extension; one
 * typed with it is taken to mean the same note, not a note named `….md.md`.
 * A path is read as a link reads one: from the vault's root whether or not
 * it opens with `/`, and a `//` as one `/`.
 */
function typed(text: string): string {
    return text.trim().replace(/\.md$/i, '').trim().replace(/\/+/g, '/').replace(/^\//, '');
}

/** The characters a folder's name cannot hold: a name's, but the `/` that ends it. */
const UNUSABLE_IN_FOLDER = /[\\:*"<>?#^[\]|]/g;

/** Why `part`, by the characters in `unusable`, cannot be a name; null when it can. */
function partCheck(part: string, unusable: RegExp, at: 'name' | 'folder'): Extract<NameCheck, { ok: false }> | null {
    const chars = part.match(unusable);
    if (chars) return { ok: false, why: 'chars', chars: [...new Set(chars)].join(''), at };
    if (part.startsWith('.')) return { ok: false, why: 'dot', at };
    return null;
}

/** A name or path as compared with another: case and normalization aside. */
function folded(text: string): string {
    return text.normalize('NFC').toLowerCase();
}

/**
 * A note's name and where it goes, as a new note for a row is named: the
 * default name and folder, whether a name or a path can be a new note's, and
 * which note a note field points at.
 *
 * A path is compared with the vault's case aside. The file systems of macOS
 * and Windows do not tell `Note.md` from `note.md`: Obsidian does not find
 * one under the other's path (`getAbstractFileByPath`), but creating one
 * where the other is fails, and a link to either resolves to the one there is
 * (measured at stage 0). So a path that differs from a note's in case alone
 * points at that note, and a folder that differs in case alone is that folder.
 */
export const NoteName = {
    /**
     * The name a row's text suggests for its note: the text without its tags,
     * its `@` notation and its `^id`, a link read as the text it shows, and
     * the characters a name cannot hold taken out. Empty when nothing is
     * left.
     */
    fromText(text: string): string {
        const shown = text
            .replace(new RegExp(WIKILINK_SOURCE, 'g'), (_, linktext: string) => {
                const bar = linktext.indexOf('|');
                return bar < 0 ? linktext : linktext.slice(bar + 1);
            })
            .replace(new RegExp(MARKDOWN_LINK_SOURCE, 'g'), '$1');
        return shown
            .split(/\s+/)
            .filter(word => !/^[#@^]/.test(word))
            .join(' ')
            .replace(UNUSABLE, '')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^\.+\s*/, '');
    },

    /**
     * The notes a row's text links to, in the order it links to them, each
     * as its link spells the note (`Folder/Note`), without the heading or
     * block it points into and the text it shows: wikilinks and embeds, and
     * Markdown links to a path in the vault (not a URL). A link into the
     * note it is written in (`[[#heading]]`) names no note, and is left out.
     */
    linksIn(text: string): string[] {
        const out: string[] = [];
        const push = (linktext: string) => {
            const { path } = parseLinktext(linktext.trim());
            if (path.trim() !== '') out.push(path.trim());
        };
        // Groups: 1 the wikilink's text; 2 the Markdown link's shown text, 3 its destination.
        for (const m of text.matchAll(new RegExp(`${WIKILINK_SOURCE}|${MARKDOWN_LINK_SOURCE}`, 'g'))) {
            if (m[1] !== undefined) {
                push(extractWikilinkTarget(m[1]));
            } else if (!/^[a-z][a-z0-9+.-]*:/i.test(m[3].trim())) {
                push(decoded(m[3].trim().replace(/^<(.*)>$/, '$1')));
            }
        }
        return out;
    },

    /**
     * The folder a new note goes to by the user's settings for new notes,
     * seen from the note `sourcePath` ('' for the vault's root).
     */
    defaultFolder(app: Pick<App, 'fileManager'>, sourcePath: string): string {
        return folderPath(app.fileManager.getNewFileParent(sourcePath));
    },

    /**
     * Whether `text`, as typed ({@link typed}), can name a new note: its
     * name (past the last `/`) a name a note can have (see
     * {@link UNUSABLE}), and each folder before it one a folder can.
     */
    check(text: string): NameCheck {
        const parts = typed(text).split('/');
        const name = parts.pop() ?? '';
        if (name.trim() === '') return { ok: false, why: 'empty', at: 'name' };
        const wrong = partCheck(name, UNUSABLE, 'name') ?? parts.map(part => partCheck(part, UNUSABLE_IN_FOLDER, 'folder')).find(Boolean);
        return wrong ?? { ok: true };
    },

    /**
     * The note a note field points at, the rules taken in order
     * (`note-suggest/send-field.md`, 行き先の決め方):
     *
     * 1. The note picked, while the vault has it.
     * 2. The text, read as the text of a `[[link]]` is ({@link typed}). A
     *    name (no `/`): the vault's notes by that name, case and
     *    normalization aside. One is that note; none, a new note in
     *    `newFolder` (the folder for new notes, '' for the root).
     * 3. A path: the note at that path from the vault's root, case aside;
     *    else the notes whose path ends in it, after a `/`, as a link finds
     *    them. One is that note; none, a new note at the path, spelt with
     *    the folders the vault has, case aside, so it goes into the folder
     *    there is rather than beside it.
     *
     * More than one note by a name or by the end of a path is no note: the
     * field does not tell them apart, and a send is not guessed at.
     */
    find(vault: NoteVault, ask: NoteAsk, newFolder: string): NoteAt {
        const notes = vault.getMarkdownFiles();
        const picked = ask.picked === null ? undefined : notes.find(f => f.path === ask.picked);
        if (picked) return { kind: 'existing', file: picked };
        const text = typed(ask.text);
        const cut = text.lastIndexOf('/');
        if (cut < 0) {
            const named = notes.filter(f => folded(f.basename) === folded(text));
            if (named.length > 0) return oneOf(text, named);
            return made(vault, `${newFolder === '' ? '' : `${newFolder}/`}${text}.md`, 'name');
        }
        const path = `${text}.md`;
        const there = notes.find(f => f.path === path) ?? notes.find(f => folded(f.path) === folded(path));
        if (there) return { kind: 'existing', file: there };
        const tail = folded(`/${path}`);
        const ending = notes.filter(f => folded(f.path).endsWith(tail));
        if (ending.length > 0) return oneOf(text, ending);
        return made(vault, `${spelledAs(vault, text.slice(0, cut))}/${text.slice(cut + 1)}.md`, 'path');
    },

    /** The vault's note at `path`, case aside, spelt as the vault spells it; the one spelt as asked first. Null when there is none. */
    fileAt(vault: NoteVault, path: string): TFile | null {
        const notes = vault.getMarkdownFiles();
        return notes.find(f => f.path === path) ?? notes.find(f => folded(f.path) === folded(path)) ?? null;
    },
};

/** The one note of `files`, or, of more than one, none: the field does not tell them apart. */
function oneOf(name: string, files: readonly TFile[]): NoteAt {
    if (files.length === 1) return { kind: 'existing', file: files[0] };
    return { kind: 'ambiguous', name, files: [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) };
}

/** A new note at `path`: the first of its folders the vault does not have, and the notes by its name elsewhere. */
function made(vault: NoteVault, path: string, by: 'name' | 'path'): NoteAt {
    const folders = vault.getAllFolders(false);
    const parts = path.split('/').slice(0, -1);
    let folderMade: string | null = null;
    for (let i = 1; i <= parts.length; i++) {
        const folder = parts.slice(0, i).join('/');
        if (!folders.some(f => f.path === folder)) {
            folderMade = folder;
            break;
        }
    }
    const name = folded(path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''));
    const namesakes = vault.getMarkdownFiles().filter(f => folded(f.basename) === name);
    return { kind: 'new', path, by, folderMade, namesakes };
}

/** A Markdown link's path, its `%20`s and the like read back; as written when it does not decode. */
function decoded(path: string): string {
    try {
        return decodeURI(path);
    } catch {
        return path;
    }
}

/** A folder's path as a note's place: '' for the root, which Obsidian calls '/'. */
function folderPath(folder: TFolder): string {
    return folder.path === '/' ? '' : folder.path;
}

/**
 * `folder` spelt as the vault spells the folders it has, case aside: as long
 * as each folder down the path is there, its own spelling; past the first
 * that is not, as asked.
 */
function spelledAs(vault: NoteVault, folder: string): string {
    const asked = folder.split('/').filter(part => part !== '');
    const folders = vault.getAllFolders(false);
    let spelt = '';
    for (let i = 0; i < asked.length; i++) {
        const next = spelt === '' ? asked[i] : `${spelt}/${asked[i]}`;
        const key = folded(next);
        const there = folders.find(f => f.path === next) ?? folders.find(f => folded(f.path) === key);
        if (!there) return [next, ...asked.slice(i + 1)].join('/');
        spelt = there.path;
    }
    return spelt;
}
