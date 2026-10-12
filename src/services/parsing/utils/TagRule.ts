import { PropertyKey } from './PropertyKey';

/**
 * What a tag is, as Obsidian has it: the one rule the plugin reads tags by
 * (`scanNotation`, `TagExtractor`), takes them from a field by (`TagInput`)
 * and writes them by, so that a tag of a task is a tag of Obsidian's
 * (`metadataCache.getTags()`, the tag pane, `tag:` search) and no other.
 *
 * The rule is Obsidian 1.14's, read from its parser and tried on notes:
 *
 * - a tag is `#`, then the characters up to the first that ends one
 *   ({@link TAG_CHAR_SOURCE}); a word of ASCII digits alone (`#123`, and
 *   `#1` of `#1.5`) is none
 * - in text, `#` begins one at its start, after whitespace (a full-width
 *   space and NBSP too), or where the notation before it ends (`#a#b` is
 *   two, `[[x]]#y` and `**#z**` are tags); not after a letter or a mark
 *   that is plain text (`日本語の#x`, `(#x`). Where notation begins and ends
 *   is Obsidian's reading of the text (`scanNotation`)
 * - in the frontmatter, `tags` (whatever its case) is a list (a text is a
 *   list of one), and an item is a tag when it is text and, without one
 *   leading `#`, one tag's word ({@link TagRule.ofFrontmatter})
 * - case is not told apart (`#CaseTag` is `#casetag`), and a tag is under
 *   each tag its `/` names (`#a/b` is under `#a`)
 */

/**
 * A character a tag holds: any but whitespace, ASCII's marks other than `-`,
 * `/` and `_`, and the general punctuation (U+2000–206F: `…`, `—`, `“`, the
 * zero-width space) and supplemental punctuation (U+2E00–2E7F) blocks.
 * Japanese marks (`、`, `「`, `！`), `＃`, emoji and letters of any script are
 * held. Obsidian's own class, written as a negated set.
 */
export const TAG_CHAR_SOURCE = String.raw`[^\u2000-\u206F\u2E00-\u2E7F'!"#$%&()*+,.:;<=>?@^\x60{|}~\[\]\\\s]`;

const TAG_WORD = new RegExp(`^${TAG_CHAR_SOURCE}+$`);
const NOT_TAG_CHAR = new RegExp(TAG_CHAR_SOURCE.replace('[^', '['), 'g');
/** Digits alone, which Obsidian takes for no tag: ASCII's only (`#１２` and `#٣` are tags). */
const DIGITS_ONLY = /^\d+$/;

/** Why a word is no tag: the characters that end one, each once in the order they come, or digits alone. */
export type TagWordFault = { kind: 'chars'; chars: string[] } | { kind: 'digitsOnly' };


export const TagRule = {
    /** Whether `word` (without `#`) is the word of one tag. */
    isWord(word: string): boolean {
        return TagRule.fault(word) === null;
    },

    /** Why `word` (without `#`) is not one tag's word, or null when it is. An empty word holds nothing to name. */
    fault(word: string): TagWordFault | null {
        if (TAG_WORD.test(word)) return DIGITS_ONLY.test(word) ? { kind: 'digitsOnly' } : null;
        return { kind: 'chars', chars: [...new Set(word.match(NOT_TAG_CHAR) ?? [])] };
    },

    /**
     * Whether a frontmatter key is one Obsidian reads tags from
     * (`parseFrontMatterTags`): `tags`, `Tags`, `TAGS`, a key's case aside
     * as every property key's is (`PropertyKey`). The full-width `ｔａｇｓ` is
     * none.
     */
    isFrontmatterKey(key: string): boolean {
        return PropertyKey.same(key, 'tags');
    },

    /**
     * The tags of a frontmatter as YAML gave it, in the steps of Obsidian's
     * `parseFrontMatterTags`: the value of the first key that is `tags`
     * whatever its case; a list's items that are text, or a text as a list
     * of one; each trimmed, and kept when, without one leading `#`, it is one
     * tag's word (as Obsidian's list of tags counts them). A YAML boolean,
     * null or number (`true`, `null`, `123`) is no text, and gives none.
     */
    ofFrontmatter(frontmatter: Readonly<Record<string, unknown>> | undefined): string[] {
        const key = frontmatter ? Object.keys(frontmatter).find(TagRule.isFrontmatterKey) : undefined;
        const value = key === undefined ? undefined : frontmatter![key];
        const items: unknown[] = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
        const out: string[] = [];
        for (const item of items) {
            if (typeof item !== 'string') continue;
            const word = item.trim().replace(/^#/, '');
            if (TagRule.isWord(word)) out.push(word);
        }
        return out;
    },

    /** The one tag Obsidian takes `tag` for, whatever its case: the key two spellings of a tag share. */
    key(tag: string): string {
        return tag.toLowerCase();
    },

    /** Whether `tag` is `under` or one below it (`a/b` is under `a`), case aside. */
    isUnder(tag: string, under: string): boolean {
        const t = TagRule.key(tag);
        const u = TagRule.key(under);
        return t === u || t.startsWith(`${u}/`);
    },

    /**
     * The tags `tag` counts as in Obsidian's list of tags (`getTags`): itself
     * without a trailing `/`, and each tag above it its `/` names, those that
     * are tags (`a/b/c` gives `a/b/c`, `a/b`, `a`; `/a` gives `/a` alone).
     */
    withParents(tag: string): string[] {
        const out: string[] = [];
        let at = tag.endsWith('/') ? tag.slice(0, -1) : tag;
        while (TagRule.isWord(at)) {
            out.push(at);
            const cut = at.lastIndexOf('/');
            if (cut < 0) break;
            at = at.slice(0, cut);
            if (at.endsWith('/')) at = at.slice(0, -1);
        }
        return out;
    },
};
