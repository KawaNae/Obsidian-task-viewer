/**
 * The notation a line of text holds inline, read as Obsidian reads it:
 * code, links, embeds and tags, and the notation around them that decides
 * where a tag may begin (emphasis, escapes, math, HTML, comments).
 *
 * The link patterns here are the one spelling of a link for every reader of
 * one (`ChildLineClassifier`, `NoteName`, the card's embed stripping), and
 * {@link scanNotation} cuts a text into notation once, so that what is
 * inside a link or code is not read again as a tag.
 */

import { TAG_CHAR_SOURCE, TagRule } from './TagRule';

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

export type Notation =
    | { kind: 'code'; start: number; end: number }
    | { kind: 'wikilink'; start: number; end: number; embed: boolean; linktext: string }
    | { kind: 'markdown-link'; start: number; end: number; embed: boolean; shown: string; destination: string }
    | { kind: 'tag'; start: number; end: number; tag: string };

/**
 * The notation of `text`, from its start, in the order it begins: code
 * spans, wikilinks and Markdown links (each an embed when `!` leads it) and
 * tags. A notation inside another that holds text is read too (a tag in an
 * emphasis or a link's shown text: `**#a**`, `[#b](x)`); one inside code, a
 * link's target, math or HTML is not (`[[報告書#見出し]]`, `` `#c` ``).
 *
 * The text is read as Obsidian's parser reads a paragraph's inline text
 * (the remark-parse 8 it builds its metadata with, and Obsidian's own
 * notation added to it; read from Obsidian 1.14's parser and tried on
 * notes). At each place, each kind of notation is tried in its order
 * ({@link METHODS}), and the first that takes the text there takes it; when
 * none does, the place is plain text up to where any kind could begin
 * next. So a tag's `#` begins one only at a place the reading stops at:
 *
 * - the start of the text, or of what a notation holds (`**#a**`, `_#b_`)
 * - after whitespace, where a tag may begin of itself (`TagRule`)
 * - where a notation ends (`#a#b`, `[[x]]#y`, `**b**#c`, `$x$#d`,
 *   `<b>#e`, `\##f`)
 *
 * and not after a letter or a mark that is plain text (`a#b`, `(#c`,
 * `*#d` with no `*` to close it). A tag of digits alone (`#123`) is none,
 * and its `#` is plain text.
 */
export function scanNotation(text: string): Notation[] {
    const out: Notation[] = [];
    tokenize(text, 0, text.length, { inLink: false, out });
    return out;
}

/** `text` without its embeds (`![[x]]`, `![alt](src)`) outside code. */
export function withoutEmbeds(text: string): string {
    let out = '';
    let at = 0;
    for (const n of scanNotation(text)) {
        if ((n.kind === 'wikilink' || n.kind === 'markdown-link') && n.embed && n.start >= at) {
            out += text.slice(at, n.start);
            at = n.end;
        }
    }
    return out + text.slice(at);
}

// ── The reading ──────────────────────────────────────────────────────────

/** What one reading of a text carries along: the notation found, and whether it is inside a link. */
interface Reading {
    /** Inside a link's text (or an HTML `<a>`), where no link begins but an image. */
    inLink: boolean;
    out: Notation[];
}

/**
 * What a kind of notation takes at the start of `value`: its length, and
 * where, within it, lies text read as notation again (an emphasis's
 * content, a link's shown text). The notation found is pushed to the
 * reading at `base`, the place `value` begins in the whole text.
 */
type Taken = { length: number; inner?: { from: number; to: number; inLink?: boolean } };

interface Method {
    /** What the notation takes at the start of `value`, or null when it is not there. */
    take(value: string, base: number, reading: Reading): Taken | null;
    /** The first place at or after `from` where the notation could begin; -1 for none. */
    locate(value: string, from: number): number;
    /** Not read inside a link's text (the bare links, which would be a link in a link). */
    notInLink?: boolean;
}

/** Reads `text` from `from` to `to` as one run of inline text, pushing what it finds to `reading`. */
function tokenize(text: string, from: number, to: number, reading: Reading): void {
    let at = from;
    while (at < to) {
        const value = text.slice(at, to);
        let taken: Taken | null = null;
        for (const method of METHODS) {
            if (method.notInLink && reading.inLink) continue;
            taken = method.take(value, at, reading);
            if (taken) break;
        }
        // Plain text, up to where any notation could begin next.
        if (!taken) taken = { length: plainLength(value) };
        if (taken.inner?.inLink) {
            // A link's text is read inside a link, and what it held is gone after it.
            const outer = reading.inLink;
            reading.inLink = true;
            tokenize(text, at + taken.inner.from, at + taken.inner.to, reading);
            reading.inLink = outer;
        } else if (taken.inner) {
            tokenize(text, at + taken.inner.from, at + taken.inner.to, reading);
        }
        at += taken.length;
    }
}

/** How much of `value` is plain text: up to the nearest place past its first character any notation could begin. */
function plainLength(value: string): number {
    let end = value.length;
    for (const method of METHODS) {
        const at = method.locate(value, 1);
        if (at !== -1 && at < end) end = at;
    }
    return end;
}

const WHITESPACE = /\s/;
const isWhitespace = (ch: string): boolean => ch !== '' && WHITESPACE.test(ch);
const isDigit = (ch: string): boolean => /^[0-9]$/.test(ch);
const isAsciiLetter = (ch: string): boolean => /^[A-Za-z]$/.test(ch);
const isWordChar = (ch: string): boolean => /^\w$/.test(ch);

/** The first `needle` in `value` at or after `from`; -1 for none. */
const locateText = (needle: string) => (value: string, from: number): number => value.indexOf(needle, from);

/** The first of `needles` in `value` at or after `from`; -1 for none. */
const locateAny = (...needles: string[]) => (value: string, from: number): number => {
    let found = -1;
    for (const needle of needles) {
        const at = value.indexOf(needle, from);
        if (at !== -1 && (found === -1 || at < found)) found = at;
    }
    return found;
};

/**
 * The first `mark` in `value` at or after `from` with whitespace before it
 * (a tag's `#`, a block id's `^`): where it may begin of itself. -1 for none.
 */
const locateAfterSpace = (mark: string) => (value: string, from: number): number => {
    for (let at = value.indexOf(mark, from); at !== -1; at = value.indexOf(mark, at + 1)) {
        if (at > 0 && isWhitespace(value[at - 1])) return at;
    }
    return -1;
};

// ── The kinds of notation, in the order Obsidian tries them ──────────────

/** `\` before ASCII punctuation or a line break: the character is plain text, and a notation may begin after it (`\##a`). */
const ESCAPED = /^[!-/:-@[-`{-~\n]$/;
const escape: Method = {
    take: (value) => (value[0] === '\\' && ESCAPED.test(value.charAt(1)) ? { length: 2 } : null),
    locate: locateText('\\'),
};

/** `<https://x>`, `<a@b.c>`. */
const autoLink: Method = {
    notInLink: true,
    take(value) {
        if (value[0] !== '<') return null;
        let at = 1;
        let head = '';
        while (at < value.length) {
            const ch = value[at];
            if (isWhitespace(ch) || ch === '>' || ch === '@' || (ch === ':' && value[at + 1] === '/')) break;
            head += ch;
            at++;
        }
        if (!head) return null;
        const mark = value.charAt(at);
        at++;
        if (mark !== '@') {
            if (mark !== ':' || value[at + 1] !== '/') return null;
            at++;
        }
        let rest = '';
        while (at < value.length && !isWhitespace(value[at]) && value[at] !== '>') rest += value[at++];
        return rest && value[at] === '>' ? { length: at + 1 } : null;
    },
    locate: locateText('<'),
};

/** The characters a bare URL's end leaves out (`https://x.y/z.` ends before `.`). */
const URL_TRAILING = new Set(['!', '*', ',', '.', ':', '?', '_', '~']);

/** A bare URL: `https://x.y/z`, `www.x.y`. */
const url: Method = {
    notInLink: true,
    take(value) {
        let at: number;
        const lower = value.slice(0, 8).toLowerCase();
        if (value.startsWith('www.')) at = 4;
        else if (lower.startsWith('http://')) at = 7;
        else if (lower.startsWith('https://')) at = 8;
        else return null;
        // The domain: labels of letters, digits, `-` and `_`, between dots.
        const hostStart = at;
        let lastDot = at - 1;
        const dots: number[] = [];
        let ch = '';
        while (at < value.length) {
            ch = value[at];
            if (ch === '.') {
                if (lastDot === at - 1) break;
                dots.push(at);
                lastDot = at;
                at++;
            } else {
                if (!isDigit(ch) && !isAsciiLetter(ch) && ch !== '-' && ch !== '_') break;
                at++;
            }
        }
        if (ch === '.') { dots.pop(); at--; }
        if (dots[0] === undefined) return null;
        const lastLabels = dots.length < 2 ? hostStart : dots[dots.length - 2] + 1;
        if (value.slice(lastLabels, at).includes('_')) return null;
        // The path: up to whitespace or `<`, less its trailing marks.
        const pathStart = at;
        let end = at;
        while (at < value.length) {
            ch = value[at];
            if (isWhitespace(ch) || ch === '<') break;
            at++;
            if (!URL_TRAILING.has(ch)) end = at;
        }
        at = end;
        if (value[at - 1] === ')') {
            let path = value.slice(pathStart, at);
            const opens = path.split('(').length - 1;
            let closes = path.split(')').length - 1;
            while (closes > opens) {
                at = pathStart + path.lastIndexOf(')');
                path = value.slice(pathStart, at);
                closes--;
            }
        }
        if (value[at - 1] === ';') {
            at--;
            if (isAsciiLetter(value.charAt(at - 1))) {
                let entity = at - 2;
                while (isAsciiLetter(value.charAt(entity))) entity--;
                if (value[entity] === '&') at = entity;
            }
        }
        return { length: at };
    },
    locate: locateAny('www.', 'http://', 'https://'),
};

const isEmailLocal = (ch: string): boolean => isDigit(ch) || isAsciiLetter(ch) || ch === '+' || ch === '-' || ch === '.' || ch === '_';

/** A bare email address: `a@b.c`. */
const email: Method = {
    notInLink: true,
    take(value) {
        let at = 0;
        let ch = value.charAt(at);
        while (isEmailLocal(ch)) ch = value.charAt(++at);
        if (at === 0 || ch !== '@') return null;
        at++;
        let dot = -1;
        while (at < value.length) {
            ch = value[at];
            if (!isDigit(ch) && !isAsciiLetter(ch) && ch !== '-' && ch !== '.' && ch !== '_') break;
            at++;
            if (dot === -1 && ch === '.') dot = at;
        }
        if (dot === -1 || dot === at || ch === '-' || ch === '_') return null;
        if (ch === '.') at--;
        return { length: at };
    },
    /** The start of the address an `@` ends the first part of: its run of the characters an address's first part holds. */
    locate(value, from) {
        for (let at = value.indexOf('@', from); at !== -1; at = value.indexOf('@', from)) {
            if (at > from && isEmailLocal(value[at - 1])) {
                let start = at;
                while (start > from && isEmailLocal(value[start - 1])) start--;
                return start;
            }
            from = at + 1;
        }
        return -1;
    },
};

const HTML_OPEN = String.raw`<[A-Za-z][A-Za-z0-9\-]*(?:\s+[a-zA-Z_:][a-zA-Z0-9:._-]*(?:\s*=\s*(?:[^"'=<>\x60\u0000- ]+|'[^']*'|"[^"]*"))?)*\s*\/?>`;
const HTML_CLOSE = String.raw`<\/[A-Za-z][A-Za-z0-9\-]*\s*>`;
/** An HTML tag, comment, processing instruction, declaration or CDATA: CommonMark's inline HTML. */
const HTML = new RegExp(String.raw`^(?:${HTML_OPEN}|${HTML_CLOSE}|<!---->|<!--(?:-?[^>-])(?:-?[^-])*-->|<[?].*?[?]>|<![A-Za-z]+\s+[^>]*>|<!\[CDATA\[[\s\S]*?\]\]>)`);

/** Inline HTML, one tag at a time (`<span>`, `</span>`): what lies between the tags is read on as text. */
const html: Method = {
    take(value, _base, reading) {
        if (value[0] !== '<' || value.length < 3) return null;
        const second = value[1];
        if (!isAsciiLetter(second) && second !== '?' && second !== '!' && second !== '/') return null;
        const m = HTML.exec(value);
        if (!m) return null;
        if (!reading.inLink && /^<a /i.test(m[0])) reading.inLink = true;
        else if (reading.inLink && /^<\/a>/i.test(m[0])) reading.inLink = false;
        return { length: m[0].length };
    },
    locate: locateText('<'),
};

const WIKILINK_AT = new RegExp(`^(!?)${WIKILINK_SOURCE}`);

/** A wikilink or its embed: `[[x#y|z]]`, `![[x]]`. Nothing in it is read. */
const wikilink: Method = {
    take(value, base, reading) {
        const m = WIKILINK_AT.exec(value);
        if (!m) return null;
        reading.out.push({ kind: 'wikilink', start: base, end: base + m[0].length, embed: m[1] === '!', linktext: m[2] });
        return { length: m[0].length };
    },
    locate(value, from) {
        const at = value.indexOf('[[', from);
        return at > from && value[at - 1] === '!' ? at - 1 : at;
    },
};

/** The first `[` or `![` at or after `from`. */
const locateBracket = locateAny('[', '![');

/**
 * A Markdown link `[shown](destination "title")` or image `![alt](src)`.
 * A link's shown text is read as notation (`[#a](x)` holds `#a`), inside a
 * link; an image's alt text and a destination are not.
 */
const markdownLink: Method = {
    take(value, base, reading) {
        let at = 0;
        const embed = value[0] === '!';
        if (embed) at++;
        if (value[at] !== '[' || (!embed && reading.inLink)) return null;
        at++;
        const shownFrom = at;
        // The shown text: up to its `]` that closes the `[`, which `(` follows.
        let depth = 0;
        let shownTo = -1;
        while (at < value.length) {
            const ch = value[at];
            if (ch === '\\') {
                at++;
            } else if (ch === '[') {
                depth++;
            } else if (ch === ']') {
                if (!depth) {
                    if (value[at + 1] !== '(') return null;
                    shownTo = at;
                    at += 2;
                    break;
                }
                depth--;
            }
            at++;
        }
        if (shownTo < 0) return null;
        while (at < value.length && isWhitespace(value[at])) at++;
        // The destination: in `<` `>`, or up to whitespace or the `)` that closes the `(`.
        let destination = '';
        if (value[at] === '<') {
            at++;
            while (at < value.length && value[at] !== '>') {
                if (value[at] === '\n') return null;
                destination += value[at++];
            }
            if (value[at] !== '>') return null;
            at++;
        } else {
            while (at < value.length) {
                let ch = value[at];
                if (isWhitespace(ch)) break;
                if (ch === '(') depth++;
                else if (ch === ')') {
                    if (depth === 0) break;
                    depth--;
                }
                if (ch === '\\') { destination += ch; ch = value.charAt(++at); }
                destination += ch;
                at++;
            }
        }
        // The title, after whitespace: in `"`, `'` or `(` `)`.
        let space = 0;
        while (at + space < value.length && isWhitespace(value[at + space])) space++;
        const quote = value.charAt(at + space);
        at += space;
        if (space && (quote === '"' || quote === '\'' || quote === '(')) {
            const close = quote === '(' ? ')' : quote;
            at++;
            while (at < value.length && value[at] !== close) {
                if (value[at] === '\\') at++;
                at++;
            }
            if (value[at] !== close) return null;
            at++;
            while (at < value.length && isWhitespace(value[at])) at++;
        }
        if (value[at] !== ')') return null;
        at++;
        reading.out.push({
            kind: 'markdown-link', start: base, end: base + at, embed,
            shown: value.slice(shownFrom, shownTo), destination,
        });
        return { length: at, inner: embed ? undefined : { from: shownFrom, to: shownTo, inLink: true } };
    },
    locate: locateBracket,
};

/** An inline footnote, `^[text]`: its text is read as notation. */
const inlineNote: Method = {
    take(value) {
        if (value[0] !== '^' || value[1] !== '[') return null;
        let at = 2;
        let depth = 0;
        let codeRun: number | undefined;
        let close = -1;
        while (at <= value.length) {
            const ch = value[at];
            if (ch === undefined) return null;
            if (codeRun === undefined) {
                if (ch === '\\') at += 2;
                else if (ch === '[') { depth++; at++; }
                else if (ch === ']') {
                    if (depth === 0) { close = at; at++; break; }
                    depth--;
                    at++;
                } else if (ch === '`') {
                    let run = 1;
                    while (value[at + run] === '`') run++;
                    codeRun = run;
                    at += run;
                } else at++;
            } else if (ch === '`') {
                let run = 1;
                while (value[at + run] === '`') run++;
                at += run;
                if (codeRun === run) codeRun = undefined;
            } else at++;
        }
        return close < 0 ? null : { length: at, inner: { from: 2, to: close } };
    },
    locate: locateText('^['),
};

/** A footnote's call, `[^1]`. */
const footnoteCall: Method = {
    take(value) {
        if (value[0] !== '[' || value[1] !== '^') return null;
        let at = 2;
        while (at < value.length) {
            const ch = value[at];
            if (ch === '\n' || ch === '\t' || ch === ' ') return null;
            if (ch === ']') return at > 2 ? { length: at + 1 } : null;
            at++;
        }
        return null;
    },
    locate: locateText('['),
};

/**
 * A reference link `[shown]`, `[shown][]`, `[shown][label]`, or its image
 * (`![alt][label]`), whether or not a definition names it: Obsidian reads
 * `[#a]` as one and its text as notation. Not a footnote's `[^`.
 */
const reference: Method = {
    take(value, _base, reading) {
        let at = 0;
        const image = value[0] === '!';
        if (image) at++;
        if (value[at] !== '[' || value[at + 1] === '^') return null;
        at++;
        const shownFrom = at;
        let depth = 0;
        let nested = false;
        while (at < value.length) {
            const ch = value[at];
            if (ch === '[') { nested = true; depth++; }
            else if (ch === ']') {
                if (!depth) break;
                depth--;
            }
            if (ch === '\\') at++;
            at++;
        }
        const shownTo = at;
        if (value[at] !== ']') return null;
        at++;
        let full = false;
        if (value[at] === '[') {
            let label = '';
            let end = at + 1;
            while (end < value.length && value[end] !== '[' && value[end] !== ']') {
                if (value[end] === '\\') { label += '\\'; end++; }
                label += value.charAt(end);
                end++;
            }
            // An unclosed `[` after the text is taken with it, as Obsidian's parser takes it.
            if (value[end] === ']') { full = label !== ''; at = end + 1; } else at++;
        } else if (shownTo === shownFrom) {
            return null;
        }
        if (!full && nested) return null;
        if (!image && reading.inLink) return null;
        return { length: at, inner: image ? undefined : { from: shownFrom, to: shownTo, inLink: true } };
    },
    locate: locateBracket,
};

/** `**strong**`, `__strong__`: what it holds is read as notation. */
const strong: Method = {
    take(value) {
        const mark = value[0];
        if ((mark !== '*' && mark !== '_') || value[1] !== mark) return null;
        let at = 2;
        let inner = 0;
        while (at < value.length) {
            let ch = value.charAt(at);
            if (ch === mark && value[at + 1] === mark) {
                ch = value.charAt(at + 2);
                if (ch !== mark) {
                    if (!value.slice(2, 2 + inner).trim()) return null;
                    return { length: inner + 4, inner: { from: 2, to: 2 + inner } };
                }
            }
            if (ch === '\\') { inner++; at++; }
            inner++;
            at++;
        }
        return null;
    },
    locate: locateAny('**', '__'),
};

/**
 * `*emphasis*`, `_emphasis_`: what it holds is read as notation. A `_`
 * that a word character follows closes none (`_a_b_`).
 */
const emphasis: Method = {
    take(value) {
        const mark = value[0];
        if (mark !== '*' && mark !== '_') return null;
        let at = 1;
        let inner = '';
        let ch = '';
        while (at < value.length) {
            const before = ch;
            ch = value.charAt(at);
            if (ch === mark) {
                ch = value.charAt(++at);
                if (ch !== mark) {
                    if (!inner.trim() || before === mark) return null;
                    if (mark === '_' && isWordChar(ch)) {
                        inner += mark;
                        continue;
                    }
                    return { length: inner.length + 2, inner: { from: 1, to: 1 + inner.length } };
                }
                inner += mark;
            }
            if (ch === '\\') { inner += ch; ch = value.charAt(++at); }
            inner += ch;
            at++;
        }
        return null;
    },
    locate: locateAny('*', '_'),
};

/** `~~strikethrough~~`: what it holds is read as notation. */
const deletion: Method = {
    take(value) {
        if (value[0] !== '~' || value[1] !== '~' || isWhitespace(value.charAt(2))) return null;
        let inner = '';
        let previous = '';
        let before = '';
        for (let at = 2; at < value.length; at++) {
            const ch = value[at];
            if (ch === '~' && previous === '~' && !(before && isWhitespace(before))) {
                return { length: inner.length + 4, inner: { from: 2, to: 2 + inner.length } };
            }
            inner += previous;
            before = previous;
            previous = ch;
        }
        return null;
    },
    locate: locateText('~~'),
};

/** A code span: a run of backticks, then text, then a run of as many. Nothing in it is read. */
const code: Method = {
    take(value, base, reading) {
        let at = 0;
        while (at < value.length && value[at] === '`') at++;
        if (at === 0 || at === value.length) return null;
        const open = at;
        let runStart: number | undefined;
        for (; at < value.length; at++) {
            if (value[at] === '`') {
                runStart ??= at;
                if (value[at + 1] !== '`' && at + 1 - runStart === open) {
                    reading.out.push({ kind: 'code', start: base, end: base + at + 1 });
                    return { length: at + 1 };
                }
            } else {
                runStart = undefined;
            }
        }
        return null;
    },
    locate: locateText('`'),
};

/** A line break: spaces, then a line break. */
const lineBreak: Method = {
    take(value) {
        const m = /^ *\n/.exec(value);
        return m ? { length: m[0].length } : null;
    },
    locate(value, from) {
        let at = value.indexOf('\n', from);
        while (at > from && value[at - 1] === ' ') at--;
        return at;
    },
};

/** `==highlight==`: what it holds is read as notation. */
const highlight: Method = {
    take(value) {
        if (!value.startsWith('==') || value.startsWith('====') || isWhitespace(value.charAt(2))) return null;
        let inner = '';
        let previous = '';
        let before = '';
        for (let at = 2; at < value.length; at++) {
            const ch = value[at];
            if (ch === '=' && previous === '=' && !(before && isWhitespace(before))) {
                return { length: inner.length + 4, inner: { from: 2, to: 2 + inner.length } };
            }
            inner += previous;
            before = previous;
            previous = ch;
        }
        return null;
    },
    locate: locateText('=='),
};

/** A tag's `#` and word (`TagRule`): the characters up to the first a tag cannot hold. */
const TAG_AT = new RegExp(`^#${TAG_CHAR_SOURCE}+`);

/** A tag, `#word`, unless its word is digits alone (`#123`). */
const tag: Method = {
    take(value, base, reading) {
        const m = TAG_AT.exec(value);
        if (!m || TagRule.fault(m[0].slice(1))?.kind === 'digitsOnly') return null;
        reading.out.push({ kind: 'tag', start: base, end: base + m[0].length, tag: m[0].slice(1) });
        return { length: m[0].length };
    },
    locate: locateAfterSpace('#'),
};

const isBlank = (ch: string): boolean => ch === ' ' || ch === '\t';

/**
 * Math, `$x$` or `$$x$$`: nothing in it is read. `$` that a space or tab
 * follows opens none, and one that a space or tab precedes or a digit
 * follows closes none (`$5 and $6` is text).
 */
const math: Method = {
    take(value) {
        if (value[0] !== '$') return null;
        let at = 1;
        const double = value[at] === '$';
        if (double) at++;
        let next = value.charAt(at);
        if (!double && isBlank(next)) return null;
        while (at < value.length) {
            const ch = next;
            next = value.charAt(at + 1);
            if (ch === '$') {
                const before = value.charAt(at - 1);
                if ((!double && !isBlank(before) && !isDigit(next)) || (double && next === '$')) {
                    at++;
                    if (double) {
                        at++;
                        // Whitespace up to a line break goes with a block's closing `$$`.
                        for (let end = at; end < value.length; end++) {
                            const after = value[end];
                            if (after === '\n') { at = end + 1; break; }
                            if (!isWhitespace(after)) break;
                        }
                    }
                    return { length: at };
                }
            } else if (ch === '\\') {
                at++;
                next = value.charAt(at + 1);
            }
            at++;
        }
        return null;
    },
    locate: locateText('$'),
};

/** A block id at the end of the text, `^id`. */
const blockId: Method = {
    take: (value) => (/^\^[a-zA-Z0-9-]+$/.test(value) ? { length: value.length } : null),
    locate: locateAfterSpace('^'),
};

/** A comment, `%%text%%`: its text is read as notation. */
const comment: Method = {
    take(value) {
        const m = /^%%(.*?)%%/.exec(value);
        return m ? { length: m[0].length, inner: { from: 2, to: 2 + m[1].length } } : null;
    },
    locate: locateText('%%'),
};

/**
 * The kinds of notation in the order Obsidian tries them at a place:
 * remark-parse's (escape, autolink, URL, email, HTML, link, reference,
 * strong, emphasis, deletion, code, break), with Obsidian's put among them
 * (wikilink before link, footnotes before reference, then highlight, tag,
 * math, block id and comment before plain text).
 */
const METHODS: readonly Method[] = [
    escape, autoLink, url, email, html, wikilink, markdownLink, inlineNote, footnoteCall, reference,
    strong, emphasis, deletion, code, lineBreak, highlight, tag, math, blockId, comment,
];
