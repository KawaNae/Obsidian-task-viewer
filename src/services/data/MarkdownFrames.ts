/**
 * What a markdown frame of a sidebar (`MarkdownFrame`) names and shows: its
 * link read as a note and a section of it, and the section read off the
 * note's lines as a heading row's text and a run of cards, one for each
 * heading nested one level in the section, each with its markdown and its
 * style.
 *
 * Nothing here looks a note up or reads a file: which note the link's path
 * names is asked of the vault in `MarkdownFrameNotes.ts`, and the note's
 * lines are the caller's to read (`views/sidebar/MarkdownFrameReader.ts`).
 */

import { parseLinktext } from 'obsidian';
import type { TaskViewerSettings } from '../../types';
import { FileParsePipeline } from '../parsing/FileParsePipeline';
import { NoteSections } from '../parsing/tree/NoteSections';
import type { SectionNode } from '../parsing/tree/Sections';
import { headingLinks, headingNames, resolveHeading, type HeadingLink } from '../parsing/utils/HeadingLinks';
import { Outline, type OutlineHeading } from '../parsing/utils/Outline';

/** What the link of a markdown frame names. */
export interface FrameTarget {
    /** The note, as a link names one: a path without its `.md`, or a shorter name a link resolves. */
    path: string;
    /**
     * The section of the note, as the link writes it from its first `#` on
     * (`#a`, `#a#b`). One that names no heading (none, or `#` alone) is the
     * whole note.
     */
    subpath: string;
}

/**
 * `link` cut where a link of Obsidian is cut: at its first `#`, the note
 * before it and the section from it on.
 */
export function frameTarget(link: string): FrameTarget {
    return parseLinktext(link);
}

/**
 * The link that names the section `subpath` of the note `path`: what
 * {@link frameTarget} cuts back into the two. `subpath` is a heading's as
 * `headingLinks` gives it, or null for the whole note.
 */
export function frameLink(path: string, subpath: string | null): string {
    return subpath === null || subpath === '' ? path : `${path}#${subpath}`;
}

/**
 * The link that names the section `subpath` of the note at `path` (a file's
 * path, with its `.md`): the path written whole, without the extension, so
 * the link names that note whatever other notes have its name. `subpath` is
 * as {@link frameLink} takes it. Not every note is named so: a path with a
 * `#` is cut there when the link is read. Whether the link names the note
 * is asked of the vault (`frameLinkMiss`).
 */
export function noteFrameLink(path: string, subpath: string | null): string {
    return frameLink(path.replace(/\.md$/i, ''), subpath);
}

/**
 * `link` turned to the note at `path` (a file's path, with its `.md`), the
 * section it names kept: what a frame's link becomes when its note is
 * renamed or moved, if it names the note there (`frameLinkMiss`).
 */
export function frameLinkAt(link: string, path: string): string {
    return noteFrameLink(path, frameTarget(link).subpath.replace(/^#/, ''));
}

/**
 * The headings of the note `lines`, each with the subpath that names it
 * (`headingLinks`), among the headings {@link readFrameContent} finds a
 * link's in: a heading's subpath here is read back as that heading.
 */
export function frameHeadings(lines: readonly string[]): HeadingLink[] {
    return headingLinks(Outline.read(lines).headings);
}

/**
 * One card of a frame: the lines under the frame's own heading, or the
 * section of a heading nested one level in it, with the style and the mask
 * a task of those lines inherits.
 */
export interface FrameCard {
    /**
     * The lines of the nested heading that opens the card, as the note
     * writes them (`## Reading`); null for the card of the lines under the
     * frame's own heading, or above the note's first heading.
     */
    heading: string | null;
    /** The card's lines, joined: the markdown it draws, from its heading's line on when it has one. */
    markdown: string;
    /** The color a task of the card's section inherits; null when it inherits none. */
    color: string | null;
    /** The line style a task of the card's section inherits; null when it inherits none. */
    linestyle: string | null;
    /**
     * What a task of the card's section shows in place of its text while
     * the view masks; null when it inherits none. A mask hidden with no
     * value, or written empty, is none, as it is for a task
     * (`NoteTasks.inheritance`).
     */
    mask: string | null;
}

/**
 * What a markdown frame shows of a note:
 *
 * - `heading`: the section of a heading, as its cards, and the heading's
 *   text as the note writes it
 * - `note`: the whole note, as its cards; it has no heading of its own to
 *   show (the frame's row names the note)
 * - `no-heading`: the note has no heading the link names
 *
 * There is always one card at least.
 */
export type FrameContent =
    | { kind: 'heading'; title: string; cards: readonly FrameCard[] }
    | { kind: 'note'; cards: readonly FrameCard[] }
    | { kind: 'no-heading' };

/**
 * What a frame shows: of its note ({@link FrameContent}), or that the note
 * its link names is not there (`no-note`).
 */
export type FrameReading = FrameContent | { kind: 'no-note' };

/**
 * The name the row of the frame of `link` shows, for what the frame shows:
 *
 * - a heading's section: the heading's text, as the note writes it
 * - the whole note: the note's name (`noteName`, the file's without its
 *   extension)
 * - nothing found: the last thing the link names, which is the last heading
 *   of its subpath, or the last part of the note's path when it names none
 */
export function frameTitle(link: string, reading: FrameReading, noteName: string | null): string {
    if (reading.kind === 'heading') return reading.title;
    if (reading.kind === 'note' && noteName !== null) return noteName;
    const { path, subpath } = frameTarget(link);
    const names = headingNames(subpath);
    return (names.length > 0 ? names[names.length - 1] : path.slice(path.lastIndexOf('/') + 1)).trim();
}

/**
 * What a frame shows of the note `lines`, for the section `subpath` names
 * ({@link FrameTarget.subpath}), as cards.
 *
 * A heading is found as a link to it is (`resolveHeading`), and its section
 * runs from under it to the next heading of its level or above. The whole
 * note's section is the note past its frontmatter.
 *
 * The section is cut into cards at the headings nested one level in it
 * (`SectionNode.children`): the first heading under the section's own
 * starts a card, which runs to the next heading of its level or above,
 * where the next card starts. A card starts with its heading's line, and
 * holds the headings deeper than it, as lines of its markdown. The lines
 * above the first of those headings make a card of their own, before them,
 * when anything is left of them, or when the section has no such heading:
 * a section without one is a single card, even an empty one.
 *
 * The lines the note reads as property lines of a card's section, or of a
 * section nested in it (`SectionNode.properties`), are left out with the
 * lines under them: they say how the section's tasks look, and are no part
 * of what the note shows. The blank lines at a card's two ends are left
 * out too, so that a blank line put between two sections changes neither.
 *
 * A card's style and mask are the ones a task written in its section would
 * inherit (`SectionNode.resolvedColor`, `resolvedLinestyle`,
 * `resolvedMask`): the frontmatter, the lines above the first heading, the
 * headings above and the section's own property lines, the nearest winning,
 * no value hiding the value above and a value that does not read saying
 * nothing. The card of the lines under the frame's own heading takes that
 * heading's, and the whole note's that of a task written above its first
 * heading. A property line of a heading deeper than a card's is not the
 * card's, and does not style or mask it.
 *
 * A tv-ignore'd note is read as any other: it has no rows, and its cards
 * are still its cards.
 */
export function readFrameContent(lines: readonly string[], subpath: string, settings: TaskViewerSettings): FrameContent {
    const { outline, root } = FileParsePipeline.sectionsOf(lines, settings);
    if (headingNames(subpath).length === 0) return { kind: 'note', cards: cardsOf(lines, root) };

    const linked = resolveHeading(outline.headings, subpath);
    const section = linked && NoteSections.all(root).find(node => node.heading === linked.heading);
    if (!linked || !section) return { kind: 'no-heading' };
    return { kind: 'heading', title: linked.heading.text, cards: cardsOf(lines, section) };
}

/** The cards of `section`: its own lines, when they are to be shown, and then one for each section nested in it. */
function cardsOf(lines: readonly string[], section: SectionNode): FrameCard[] {
    const { children } = section;
    const from = section.heading ? section.heading.end : section.startLine;
    const lead = cardOf(lines, section, null, from, children[0]?.startLine ?? section.endLine);
    const nested = children.map(child => cardOf(lines, child, child.heading, child.startLine, child.endLine));
    return lead.markdown !== '' || nested.length === 0 ? [lead, ...nested] : nested;
}

/**
 * The card of the lines `from` to `to` of `section`, opened by `heading`
 * when it is a nested heading's, with the section's style and mask.
 */
function cardOf(lines: readonly string[], section: SectionNode, heading: OutlineHeading | null, from: number, to: number): FrameCard {
    const hidden = new Set<number>();
    for (const node of NoteSections.all(section)) {
        for (const property of node.properties.lines) {
            for (let line = property.line; line < property.end; line++) hidden.add(line);
        }
    }

    const shown: string[] = [];
    for (let line = from; line < to; line++) {
        if (!hidden.has(line)) shown.push(lines[line]);
    }
    return {
        heading: heading && lines.slice(heading.line, heading.end).join('\n'),
        markdown: withoutBlankEnds(shown).join('\n'),
        color: section.resolvedColor ?? null,
        linestyle: section.resolvedLinestyle ?? null,
        mask: section.resolvedMask || null,
    };
}

/** `lines` without the blank lines at its two ends. */
function withoutBlankEnds(lines: readonly string[]): readonly string[] {
    let from = 0;
    let to = lines.length;
    while (from < to && Outline.isBlank(lines[from])) from++;
    while (to > from && Outline.isBlank(lines[to - 1])) to--;
    return lines.slice(from, to);
}
