/**
 * A link to a heading of a note, read and written off the note's lines: the
 * headings are the ones the outline reads (`OutlineReading.headings`), never
 * Obsidian's cache of the note. The cache describes the file at some other
 * moment (inside a write it is the file before the write), and a reader and
 * a writer that ask these lines the same question find the same section.
 *
 * The subpath is what a link writes after the note: `#a` for a heading, and
 * `#a#b` for a heading `b` looked for below a heading `a`. It is taken with
 * or without its first `#`, as `parseLinktext` cuts it or as
 * {@link headingLinks} gives it.
 */

import { stripHeading, stripHeadingForLink } from 'obsidian';
import type { OutlineHeading } from './Outline';

/**
 * A heading's name as Obsidian compares it when it resolves a link to a
 * heading: the API's `stripHeading` (the ASCII marks but `'`, `-` and `_`
 * read as a space, spaces run together and trimmed off), and case aside.
 * `**bold**` is `bold`, `[[Other]]` is `other`, `a:b` is `a b`. Other
 * characters (full-width ones) are compared as they are.
 */
export function headingKey(name: string): string {
    return stripHeading(name).toLowerCase();
}

/** The names `subpath` writes, outermost first: its parts between the `#`, the empty ones left out. None for a subpath that names no heading. */
export function headingNames(subpath: string): string[] {
    return subpath.split('#').filter(name => name !== '');
}

/** The heading a link names, and where its section ends. */
export interface LinkedHeading {
    heading: OutlineHeading;
    /**
     * The next heading of its level or above, which its section runs up to;
     * null when the section runs to the end of the note.
     */
    next: OutlineHeading | null;
}

/**
 * The heading `subpath` names among `headings` (a note's, top to bottom), or
 * null when it names none. The walk is that of Obsidian's `resolveSubpath`,
 * so a link written in a note and a subpath read here name the same heading:
 *
 * - the first heading of the first name is taken, then the first heading
 *   below it of a deeper level and the second name, and so on; the heading
 *   of the last name is the answer. Names are compared by {@link headingKey}
 * - of two headings of one name, the first is named. `#a#b` asks for a `b`
 *   below `a` and deeper than it, not for one in `a`'s section: a `b` under
 *   a later heading is found when `a`'s section has none
 * - a name whose level does not go deeper than the one before it is not
 *   found: `#a#b` names no `b` of `a`'s level or above
 *
 * A subpath of one name that opens with `^` or `[^` names a block or a
 * footnote, neither of which the outline reads: it names no heading here.
 */
export function resolveHeading(headings: readonly OutlineHeading[], subpath: string): LinkedHeading | null {
    return walk(headings, heading => headingKey(heading.text), subpath);
}

/** {@link resolveHeading}, with each heading's key asked of `keyOf`. */
function walk(
    headings: readonly OutlineHeading[],
    keyOf: (heading: OutlineHeading) => string,
    subpath: string,
): LinkedHeading | null {
    const names = headingNames(subpath);
    if (names.length === 0) return null;
    if (names.length === 1 && (names[0].startsWith('^') || names[0].startsWith('[^'))) return null;
    const keys = names.map(headingKey);

    let matched = 0;
    let level = 0;
    let found: OutlineHeading | null = null;
    for (const heading of headings) {
        if (found) {
            if (heading.level <= level) return { heading: found, next: heading };
        } else if (heading.level > level && keyOf(heading) === keys[matched]) {
            matched++;
            level = heading.level;
            if (matched === keys.length) found = heading;
        }
    }
    return found && { heading: found, next: null };
}

/** A heading of a note, and what a link writes to name it. */
export interface HeadingLink {
    /** The heading: its text and its level are what a list of the note's headings shows. */
    heading: OutlineHeading;
    /**
     * The subpath that names the heading, without its first `#` (`a`, or
     * `a#b`); null for a heading no subpath made here names.
     */
    subpath: string | null;
}

/**
 * Every heading of `headings` (a note's, top to bottom) with the subpath
 * that names it:
 *
 * - its own name, when that names it: no heading above it in the note has
 *   the name
 * - otherwise the names of the headings it stands under, outermost first,
 *   and its own, when those name it
 * - otherwise none: neither of the two finds it. Each finds another heading
 *   or nothing, since the walk takes the first heading of a name and then
 *   the first deeper one of the next name wherever it stands: of `# P`,
 *   `## Q`, `### X`, `## X`, `P#X` finds `### X`, and of `# X`, `### P`,
 *   `# P`, `## X`, `P#X` finds nothing, `### P` having no deeper `X`. Other
 *   subpaths may still name it (`X#X` names the last `X`), but none is
 *   looked for
 *
 * A subpath names a heading when {@link resolveHeading} finds that heading
 * by it, so what is written here is read back as the heading it was written
 * for. A name is written through the API's `stripHeadingForLink`, which
 * takes out what would cut the link (`#`, `|`, `^`, `[[`); a name nothing is
 * left of is left out.
 */
export function headingLinks(headings: readonly OutlineHeading[]): HeadingLink[] {
    const keys = new Map<OutlineHeading, string>();
    const keyOf = (heading: OutlineHeading) => {
        let key = keys.get(heading);
        if (key === undefined) keys.set(heading, key = headingKey(heading.text));
        return key;
    };

    // The headings the one being read stands under, outermost first.
    const above: OutlineHeading[] = [];
    return headings.map(heading => {
        while (above.length > 0 && above[above.length - 1].level >= heading.level) above.pop();
        const name = stripHeadingForLink(heading.text);
        const path = [...above.map(h => stripHeadingForLink(h.text)), name].filter(part => part !== '').join('#');
        above.push(heading);

        const subpath = [name, path].find(candidate => walk(headings, keyOf, candidate)?.heading === heading);
        return { heading, subpath: subpath ?? null };
    });
}
