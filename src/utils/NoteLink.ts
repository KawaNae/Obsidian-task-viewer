import type { App, FileManager, TFile } from 'obsidian';
import { useMarkdownLinks } from './ObsidianConfig';

/**
 * How the plugin spells a link to a file, in the two ways Obsidian does:
 * as it makes a link to a file ({@link noteLink}), and as its `[[` writes
 * the candidate picked ({@link pickedLink}). Both read the user's settings
 * (wikilink or Markdown, the shortest, relative or absolute path) through
 * Obsidian.
 */

/**
 * A link to `file`, spelt as the user's settings spell a new link
 * (`generateMarkdownLink`): wikilink or Markdown, and the shortest path, the
 * relative one or the absolute one, seen from the note the link is written
 * in (`sourcePath`). `subpath` points into the file (`#heading`); `display`
 * is the text the link shows.
 *
 * Obsidian drops a display text that reads as the link does (measured at
 * stage 0), so a note the shortest path names by its name alone, shown by
 * its name, is linked as `[[Note]]`, and one it has to name by its path,
 * since another note has its name, as `[[Folder/Note|Note]]`: whether the
 * path is needed is Obsidian's to answer, not ours.
 *
 * The link a row sent to a note leaves where it stood (`SendWriter`).
 */
export function noteLink(
    fileManager: Pick<FileManager, 'generateMarkdownLink'>,
    file: TFile,
    sourcePath: string,
    opts: { subpath?: string; display?: string } = {},
): string {
    return fileManager.generateMarkdownLink(file, sourcePath, opts.subpath, opts.display);
}

/**
 * What a candidate of `[[` links to: a file, a file by one of its aliases,
 * the target of an unresolved link (no file), or a heading of a file, its
 * note named as it was typed (`linkpath`; '' for the note the link is in).
 */
export type PickedTarget =
    | { kind: 'file'; file: TFile }
    | { kind: 'alias'; file: TFile; alias: string }
    | { kind: 'unresolved'; linkpath: string }
    | { kind: 'heading'; file: TFile; linkpath: string; heading: string };

/** The files Obsidian links to without a display text even by a path: the images (its unpublished `hb`). */
const IMAGE_EXTENSIONS = new Set(['bmp', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif']);

/**
 * The link Obsidian's `[[` writes for the candidate `target` picked in the
 * note at `sourcePath`, copied from its unpublished writer (`KR` of
 * Obsidian 1.13.7, `note-suggest/implementation.md`, 段3):
 *
 * - A file is named as `fileToLinktext` names it from the note (the shortest,
 *   relative or absolute path, a note without `.md` in a wikilink). Named by
 *   a path, a file other than an image shows its name: `[[a/Dup|Dup]]`,
 *   `[[a/画像.png]]`.
 * - An alias shows itself: `[[元のノート|別名]]`.
 * - An unresolved link names its target as it is: `[[Later]]`.
 * - A heading is the note as typed and the heading, its characters a link
 *   cannot hold as spaces: `[[ノート#見出し]]`, `[[#見出し]]` in its own note.
 * - With Markdown links, the text shown is the file's name (without its
 *   extension), the alias, the target or the heading, and the path is
 *   Obsidian's with its spaces encoded: `[見出し](ノート.md#見出し)`.
 *
 * Not `generateMarkdownLink`: it shows a file's whole name, and a heading's
 * note, where Obsidian's `[[` does not.
 */
export function pickedLink(app: Pick<App, 'metadataCache' | 'vault'>, target: PickedTarget, sourcePath: string): string {
    const markdown = useMarkdownLinks(app as App);
    const linktext = (file: TFile) => app.metadataCache.fileToLinktext(file, sourcePath, !markdown);
    let shown: string;
    let path: string;
    let display: string | null = null;
    switch (target.kind) {
        case 'file':
            shown = target.file.basename;
            path = linktext(target.file);
            if (!IMAGE_EXTENSIONS.has(target.file.extension) && path.includes('/')) display = shown;
            break;
        case 'alias':
            shown = display = target.alias;
            path = linktext(target.file);
            break;
        case 'unresolved':
            shown = path = target.linkpath;
            break;
        case 'heading': {
            shown = target.heading;
            let note = target.linkpath;
            if (markdown && note !== '' && target.file.extension === 'md' && !note.endsWith('.md')) note += '.md';
            path = `${note}#${headingSubpath(target.heading)}`;
            break;
        }
    }
    if (markdown) return `[${shown}](${encodeTarget(path)})`;
    return `[[${path}${display !== null ? `|${display}` : ''}]]`;
}

/** A heading as a link names it: the characters a link cannot hold (`:#|^\`, `%%`, `[[`, `]]`, a line break) as spaces, spaces folded. */
export function headingSubpath(heading: string): string {
    return heading.replace(/([:#|^\\\r\n]|%%|\[\[|]])/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A Markdown link's target as Obsidian writes it: backslashes, control characters and spaces percent-encoded. */
function encodeTarget(path: string): string {
    // eslint-disable-next-line no-control-regex -- Obsidian encodes these control characters
    return path.replace(/[\\\x00\x08\x0B\x0C\x0E-\x1F ]/g, (ch) => encodeURIComponent(ch));
}
