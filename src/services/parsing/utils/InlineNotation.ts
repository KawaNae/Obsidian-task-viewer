/**
 * The notation a line of text holds inline: code, links, embeds and tags.
 *
 * The link patterns here are the one spelling of a link for every reader of
 * one (`ChildLineClassifier`, `NoteName`, the card's embed stripping), and
 * {@link scanNotation} cuts a text into them once, so that what is inside a
 * link or code is not read again as a tag.
 */

/**
 * A character of a wikilink's text, between `[[` and `]]`: no bracket and no
 * line break. Obsidian's link text holds no `[` or `]` (a note's name cannot
 * either), and leaving `[` out keeps `[[[a]], b]` a list whose first item is
 * `[[a]]` rather than a link to `[a`.
 */
export const WIKILINK_TEXT_SOURCE = String.raw`[^\[\]\r\n]`;

/** A wikilink, `[[target#heading|shown]]`; group 1 is its text. */
export const WIKILINK_SOURCE = String.raw`\[\[(${WIKILINK_TEXT_SOURCE}*)\]\]`;

/** A Markdown link, `[shown](destination)`; group 1 is the shown text, group 2 the destination. */
export const MARKDOWN_LINK_SOURCE = String.raw`\[([^\]\r\n]*)\]\(([^)\r\n]*)\)`;

/**
 * A code span: a whole run of backticks, then text, then a whole run of as
 * many (CommonMark's code span). Group 1 is the opening run.
 */
const CODE_SOURCE = String.raw`(?<!\x60)(\x60+)(?!\x60)[\s\S]*?(?<!\x60)\1(?!\x60)`;

/**
 * A tag: `#` where no ASCII word character stands before it (`\B`), then
 * the characters up to a blank or the next `#`. The same reading the plugin always had,
 * now applied only to the text outside code and links.
 */
const TAG_SOURCE = String.raw`\B#([^\s#]+)`;

export type Notation =
    | { kind: 'code'; start: number; end: number }
    | { kind: 'wikilink'; start: number; end: number; embed: boolean; linktext: string }
    | { kind: 'markdown-link'; start: number; end: number; embed: boolean; shown: string; destination: string }
    | { kind: 'tag'; start: number; end: number; tag: string };

// Alternatives in the order they win at one position: code, then links
// (an embed is a link with `!`), then a tag. Groups, in order:
// 1 code run; 2 wikilink `!`, 3 its text; 4 Markdown `!`, 5 shown, 6 destination; 7 tag.
const NOTATION_SOURCE = [
    CODE_SOURCE,
    `(!?)${WIKILINK_SOURCE}`,
    `(!?)${MARKDOWN_LINK_SOURCE}`,
    TAG_SOURCE,
].join('|');

/**
 * The notation of `text`, from its start: code spans, wikilinks and Markdown
 * links (each an embed when `!` leads it) and tags. What lies between is
 * plain text. A notation inside another is not one of its own: `#` inside a
 * link (`[[報告書#見出し]]`) or code is no tag.
 */
export function scanNotation(text: string): Notation[] {
    const out: Notation[] = [];
    for (const m of text.matchAll(new RegExp(NOTATION_SOURCE, 'g'))) {
        const start = m.index;
        const end = start + m[0].length;
        if (m[1] !== undefined) {
            out.push({ kind: 'code', start, end });
        } else if (m[3] !== undefined) {
            out.push({ kind: 'wikilink', start, end, embed: m[2] === '!', linktext: m[3] });
        } else if (m[5] !== undefined) {
            out.push({ kind: 'markdown-link', start, end, embed: m[4] === '!', shown: m[5], destination: m[6] });
        } else {
            out.push({ kind: 'tag', start, end, tag: m[7] });
        }
    }
    return out;
}

/** `text` without its embeds (`![[x]]`, `![alt](src)`) outside code. */
export function withoutEmbeds(text: string): string {
    let out = '';
    let at = 0;
    for (const n of scanNotation(text)) {
        if ((n.kind === 'wikilink' || n.kind === 'markdown-link') && n.embed) {
            out += text.slice(at, n.start);
            at = n.end;
        }
    }
    return out + text.slice(at);
}
