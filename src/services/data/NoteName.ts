import { type App, type TFile, type TFolder, parseLinktext } from 'obsidian';
import { extractWikilinkTarget } from '../../utils/WikilinkUtils';
import { MARKDOWN_LINK_SOURCE, WIKILINK_SOURCE } from '../parsing/utils/InlineNotation';

/** What {@link NoteName} asks of the vault: its files and its folders. */
export type NoteVault = Pick<App['vault'], 'getFiles' | 'getMarkdownFiles' | 'getAllFolders'>;

/**
 * The characters a note's name cannot hold: those a path or a file system
 * gives a meaning to (`/ \ :`, and `* " < > ?`, which Windows does not allow
 * in a file's name — the vault may be opened there), and those that end or
 * cut a link to the note (`# ^ [ ] |`).
 */
const UNUSABLE = /[/\\:*"<>?#^[\]|]/g;

/** Whether a name can be the name of a note, and why not (see {@link NoteName.check}). */
export type NameCheck =
    | { ok: true }
    | { ok: false; why: 'empty' }
    /** `chars`: each character it cannot hold, once, in the order it holds them. */
    | { ok: false; why: 'chars'; chars: string }
    /** A name that opens with a dot names a note Obsidian does not show. */
    | { ok: false; why: 'dot' };

/**
 * The note a name and a folder point at (see {@link NoteName.at}): one of the
 * vault's, or a path no note is at, where one is made.
 *
 * `namesakes` are the vault's other notes by the same name, in other folders:
 * a link to the note then has to name its path, since Obsidian resolves a
 * name without one to one of them.
 */
export type NoteAt =
    | { kind: 'new'; path: string; namesakes: readonly TFile[] }
    /**
     * `file` may be spelt otherwise than the path asked, in its case: the
     * vault's own spelling, which is what the user is shown.
     */
    | { kind: 'existing'; file: TFile; namesakes: readonly TFile[] };

/**
 * A name as typed, as the name of the note: the spaces at its ends, and a
 * `.md` at its end in any case, left out. The note's name is without the
 * extension; one typed with it is taken to mean the same note, not a note
 * named `….md.md`.
 */
function typed(name: string): string {
    return name.trim().replace(/\.md$/i, '').trim();
}

/** A name or path as compared with another: case and normalization aside. */
function folded(text: string): string {
    return text.normalize('NFC').toLowerCase();
}

/**
 * A note's name and where it goes, as a new note for a row is named: the
 * default name and folder, whether a name can be one, and which note a name
 * and a folder point at.
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

    /** Whether `name`, as typed, can be a note's name (see {@link UNUSABLE}, {@link typed}). */
    check(name: string): NameCheck {
        const trimmed = typed(name);
        if (trimmed === '') return { ok: false, why: 'empty' };
        const unusable = trimmed.match(UNUSABLE);
        if (unusable) return { ok: false, why: 'chars', chars: [...new Set(unusable)].join('') };
        if (trimmed.startsWith('.')) return { ok: false, why: 'dot' };
        return { ok: true };
    },

    /**
     * The note `name`, as typed ({@link typed}), in `folder` ('' for the root) points at:
     * a note of the vault whose path is that one, case aside, or a new note
     * at that path — spelt with the folders the vault has, case aside, so it
     * goes into the folder there is rather than beside it.
     */
    at(vault: NoteVault, folder: string, name: string): NoteAt {
        const base = typed(name);
        const place = spelledAs(vault, folder);
        const path = `${place === '' ? '' : `${place}/`}${base}.md`;
        const key = folded(path);
        const file = vault.getFiles().find(f => f.path === path) ?? vault.getFiles().find(f => folded(f.path) === key);
        const named = folded(file?.basename ?? base);
        const namesakes = vault.getMarkdownFiles().filter(f => f !== file && folded(f.basename) === named);
        return file ? { kind: 'existing', file, namesakes } : { kind: 'new', path, namesakes };
    },
};

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
