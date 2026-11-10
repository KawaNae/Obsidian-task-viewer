/**
 * Which note the link of a markdown frame names, asked of the vault: the
 * note part of the link, cut as `frameTarget` cuts it, found as a link
 * finds a note (`noteAt`). A frame finds its note by this, and a link is
 * written for a note only when this reads it back as that note, as a
 * heading's subpath is written only when it is read back as that heading
 * (`headingLinks`).
 *
 * What the link of a note is, is `MarkdownFrames`' to say, which looks
 * nothing up.
 */

import type { MetadataCache, TFile } from 'obsidian';
import { noteAt } from '../../utils/NoteLink';
import { frameTarget } from './MarkdownFrames';

type LinkpathCache = Pick<MetadataCache, 'getFirstLinkpathDest'>;

/** The note the frame link `link` names; null when it names none. */
export function frameNote(metadataCache: LinkpathCache, link: string): TFile | null {
    return noteAt(metadataCache, frameTarget(link).path);
}

/**
 * Whether the frame link `link`, written for the note `note`, names that
 * note when it is read. One that does not names another note, or none:
 *
 * - a path with a `#` (`C#/Note`, `C# memo`): a link is cut at its first
 *   `#`, so the rest is read as a heading, as Obsidian reads its own links
 * - a name that, its `.md` taken off, is the path of another file
 *   (`foo.md.md` beside `foo.md`, `x.pdf.md` beside `x.pdf`)
 */
export function frameLinkNames(metadataCache: LinkpathCache, link: string, note: TFile): boolean {
    return frameNote(metadataCache, link) === note;
}
