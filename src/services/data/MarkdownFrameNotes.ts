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
import { frameTarget, noteFrameLink } from './MarkdownFrames';

type LinkpathCache = Pick<MetadataCache, 'getFirstLinkpathDest'>;

/** The note the frame link `link` names; null when it names none. */
export function frameNote(metadataCache: LinkpathCache, link: string): TFile | null {
    return noteAt(metadataCache, frameTarget(link).path);
}

/**
 * Why a frame link written for a note does not name it when it is read:
 *
 * - `cut`: the note part read is shorter than the path written, a link
 *   being cut at its first `#` and the rest read as a heading, as Obsidian
 *   reads its own links (`C#/Note`, `C# memo`)
 * - `other`: the note part is read whole and names another file, or none:
 *   a name that, its `.md` taken off, is the path of another file
 *   (`foo.md.md` beside `foo.md`, `x.pdf.md` beside `x.pdf`)
 */
export type FrameLinkMiss = 'cut' | 'other';

/**
 * Why the frame link `link`, written for the note `note` (by
 * `noteFrameLink` or `frameLinkAt`, its path whole), does not name that
 * note when it is read; null when it names it.
 */
export function frameLinkMiss(metadataCache: LinkpathCache, link: string, note: TFile): FrameLinkMiss | null {
    if (frameNote(metadataCache, link) === note) return null;
    return frameTarget(link).path === noteFrameLink(note.path, null) ? 'other' : 'cut';
}
