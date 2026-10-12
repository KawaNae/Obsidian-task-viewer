/**
 * The tags the plugin reads are Obsidian's, in the running Dev vault:
 * Obsidian is the spec of what a tag is (`TagRule`), and this checks the
 * plugin against it. For notes of the forms the rule was found on, each
 * row's tags are the tags Obsidian's metadata cache reads on the row's line
 * (`cache.tags`), and each note's tags, its frontmatter's with them, are
 * the ones Obsidian's list of tags (`getTags()`) counts of that note. When
 * Obsidian's rule changes with its version, this is where it shows.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (path in dev-paths.mjs) open,
 *     with a build that has TagRule
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/scanning/tag-rule.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isObsidianRunning, obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';
import { TagRule } from '../../../src/services/parsing/utils/TagRule';

const DIR = 'test-int-tags';

/** `#a<ch>b` and `x<ch>#tag`, over the characters the rule was tried with. */
const CHARS = [...'!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~', '、', '。', '「', '」', '（', '）', '！', '？', '，', '．', '：', '；', '・',
    '…', '—', '–', '“', '”', '‘', '’', '〜', '～', '＃', '　', ' ', '​', ' ', '\t', '€', '£', '©', '°', '±', '×',
    '÷', '😀', 'é', 'ß', '中'];

/** Where a tag may begin: at the start, after whitespace, after notation, and not after a letter or a mark. */
const STARTS = [
    '日本語の#直後', '#comma, x', '#period. x', '(#paren) x', '「#kagi」 x', '#touten、x', '#kuten。x',
    '#semi; #colon: #bang! #q? x', '#amp&b #apos\'b #quote"b x', '#123', '#2026-10-12', '#1a', '#CaseTag', '#casetag',
    '#tag#tag2', 'abc#mid', '#ok/nested_tag-x', '[[x]]#afterlink `c`#aftercode [[y#h]]', 'x　#zenkaku x #nbsp',
];

/** Emphasis, its nesting and its marks left open, and escapes. */
const EMPH = [
    'a *#b* c', '***a* b** #e', '***#a* b**', '**#a *b***', '~~#s~~', '==#h==', 'a_b_#c', '**a**b#c',
    'x **a#b** y', '*a* #b *c*', '**a *b***#f', '*a **b***#g', '_a_#b', '__#a__', 'a\\*#b*', '**#x**#y**#z**',
    '~~a~~#b', '==a==#b', '==#a ==b', 'a == #x ==', '***#a***', '***a** b* #c', '*a **#b** c*', '**a*#b*c**',
    '*a*#b*c*', '__a__#b', '_a_b_ #c', '_a _#b_', 'x_#a_', 'a*#b*', 'a**#b**', '*#a **#b***#c',
    '**a**#b**c**#d', '* #a*', '** #a**', '**a #b**', '~~ #a~~', '~~a #b~~#c', '==a #b==#c', '=#a= #b', '***',
    '*#a', '**#a*', '*#a**', '\\*#a*', '*\\*#a*', '_#a__', '__#a_', '*_#a_*', '_*#a*_', '**_#a_**#b',
    'a ***b*** #c***d***#e', '[*#a*](u)#b', '**[#a](u)**',
];

/** Math, `$x$` and `$$x$$`: nothing in it is read, and a tag may begin after it. */
const MATH = [
    '$x$#m', '$#m$ z', '$ #m$ z', '\\$#m', 'x $$#m$$ y', 'x $y $#z', '$a$ #b $c$', '$a $#b', '$$a$$#b',
    '$5 #b and $6', '$a$b#c', '$a$ $#b$', '$ a$#b', '$a $b$#c', '$1$#a', '$a$1 #b', '$$ a $$#b', '$$#a',
    'x$#a$', '\\$#a$', '$a\\$#b$#c',
];

/** Inline HTML: its tags are read one at a time, and what lies between them is text. */
const HTML = [
    '<span>#h</span> z', '<span class="#x">a</span>#y', 'a<b>#c</b>', 'a <!-- #c --> b', '<b>#c', '</b>#c',
    'a<br>#c', '[x](<u #a>) #b', '<span>a</span>#b', '<a href="x">#a</a> [b](c)#d', '<em>#a</em>',
    '<x y="#a">#b',
];

/** Links, references, footnotes, comments, code, escapes, bare URLs and addresses. */
const NOTATION = [
    '[#lt](http://x) z', '[#ref] z', '[#ref][r] z', 'x %%#c%% y', '%%#c%%#d', 'a ^[#note] z', 'a [^#fn] z',
    'x ^blk#a', 'http://a.com/#x y', '<http://a.com>#y', 'a@b.com#c', 'a\\#b #c', '%%a%%#e', '[a](u)#t',
    '[#a #b](u)', '![#img](u) z', '[t][#r] z', '[[x]]#y', '`x`#y', 'x ^[note #n]', '^[#n]#m', '[^1]#f',
    '<http://x.y>#a', 'https://x.y/z#a #b', 'www.x.y#a', 'x@y.z#a', '[#a]', '[[a]]]#b', '[x](u "t #a") #b',
    '`a`#b`c`#d', '``#a``#b', '`#a', 'a`b`#c', '\\`#a`', '#a\\#b', '#a\\ #b', 'x\\\\#a', '\\\\#a', '&amp;#a',
    '&#35;a #b', '<1>#a', 'a<#b', '%%a%% #b %%#c', '^[a]#b', '[^a]#b', '[a][b]#c', '[a][]#c', '[#a][]',
    '[](u)#b', '![](u)#b', '![a]#b', '[a] #b', '[[a]] #b [[c#d]]#e', '![[a]]#b', '[[a|b#c]]', '!#a', '! #a',
];


/** A note of rows, one per text, each after an id; `bare` rows have nothing before the text. */
const rowsNote = (id: string, texts: readonly string[], bare: readonly string[] = []) => [
    ...texts.map((text, i) => `- [ ] ${id}${i} ${text}`),
    ...bare.map(text => `- [ ] ${text}`),
].join('\n') + '\n';

const LINE_NOTES: Record<string, string> = {
    'chars.md': [
        ...CHARS.map((ch, i) => `- [ ] in${i} #a${ch}b`),
        ...CHARS.map((ch, i) => `- [ ] pr${i} x${ch}#tag`),
        ...['#123', '#12/34', '#1_2', '#1-2', '#-1', '#_1', '#1.5', '#/a', '#a/', '#a//b', '#٣', '#１２', '#123#abc']
            .map((tag, i) => `- [ ] nm${i} ${tag}`),
    ].join('\n') + '\n',
    'starts.md': rowsNote('s', STARTS, ['#atstart x', '**#strong** x', '$x$#aftermath', '[[x]]#afterlink']),
    'emph.md': rowsNote('e', EMPH),
    'math.md': rowsNote('m', MATH),
    'html.md': rowsNote('h', HTML),
    'notation.md': rowsNote('n', NOTATION),
};

/**
 * Frontmatters, and the tags Obsidian lists of each (`getTags()` of the
 * note, case aside): the key `tags` whatever its case, the first such key;
 * a text a list of one; of the items, the text that is one tag's word.
 */
const FRONTMATTERS: Record<string, { yaml: string; listed: string[] }> = {
    'fm-space.md': { yaml: 'tags: alpha beta', listed: [] },
    'fm-comma.md': { yaml: 'tags: gamma, delta', listed: [] },
    'fm-single.md': { yaml: 'tags: solo', listed: ['solo'] },
    'fm-list.md': { yaml: 'tags:\n  - "#hashed"\n  - Mixed/Case', listed: ['hashed', 'mixed/case', 'mixed'] },
    'fm-flow.md': { yaml: 'tags: [flowa, flowb]', listed: ['flowa', 'flowb'] },
    'fm-items.md': {
        yaml: 'tags:\n  - foo bar\n  - a.b\n  - "123"\n  - x,y\n  - (paren)\n  - 日本語、句点。\n  - "#one #two"',
        listed: ['日本語、句点。'],
    },
    'fm-items2.md': {
        yaml: 'tags:\n  - a#b\n  - "#lead"\n  - "##dbl"\n  - tail#\n  - "a\\tb"\n  - "a　b"\n  - "a b"\n  - "/"\n  - "#"\n  - a…b\n  - " #pad "',
        listed: ['lead', 'pad'],
    },
    'fm-key-upper.md': { yaml: 'TAGS: [upper1, upper2]', listed: ['upper1', 'upper2'] },
    'fm-key-cap.md': { yaml: 'Tags: capital', listed: ['capital'] },
    'fm-key-first.md': { yaml: 'tags: firstkey\nTags: secondkey', listed: ['firstkey'] },
    'fm-key-first2.md': { yaml: 'Tags: firstcap\ntags: secondlower', listed: ['firstcap'] },
    'fm-key-singular.md': { yaml: 'tag: singular', listed: [] },
    'fm-yaml-types.md': {
        yaml: 'tags: [true, False, null, ~, 123, 1.5, "false", "123", 2026-10-12, yes, [nested], {a: map}, typed]',
        listed: ['false', '2026-10-12', 'yes', 'typed'],
    },
    'fm-yaml-bool.md': { yaml: 'tags: true', listed: [] },
    'fm-yaml-number.md': { yaml: 'tags: 42', listed: [] },
    'fm-yaml-date.md': { yaml: 'tags: 2026-10-13', listed: ['2026-10-13'] },
};

const path = (name: string) => `${DIR}/${name}`;
const fmNote = (name: string) => `---\n${FRONTMATTERS[name].yaml}\n---\n- [ ] ${name.replace(/\.md$/, '')} task\n`;
const NOTES: Record<string, string> = {
    ...LINE_NOTES,
    ...Object.fromEntries(Object.keys(FRONTMATTERS).map(name => [name, fmNote(name)])),
};

interface Row { file: string; line: number; content: string; tags: string[]; cascade: string[] }
interface Seen {
    rows: Row[];
    /** Per note, per line, the tags Obsidian's metadata cache reads there. */
    lineTags: Record<string, Record<number, string[]>>;
    /** Per note, the tags Obsidian's list of tags (`getTags()`) counts of that note alone. */
    listed: Record<string, string[]>;
}

/**
 * What the plugin and Obsidian each read of the notes. A note's own part of
 * `getTags()` is Obsidian's own count run over that one note's cache (its
 * `iterateFileCache` handed the note alone), so the rest of the vault does
 * not enter it.
 */
function seen(): Seen {
    const result = obsidianEval(`(() => {
        const plugin = app.plugins.plugins['obsidian-task-viewer'];
        const files = app.vault.getMarkdownFiles().filter(f => f.path.startsWith(${JSON.stringify(DIR + '/')}));
        const rows = plugin.getIndex().getTasks().filter(t => t.file.startsWith(${JSON.stringify(DIR + '/')}))
            .map(t => ({ file: t.file, line: t.line, content: t.content, tags: t.tags, cascade: t.cascadeContext?.tags ?? [] }));
        const lineTags = {};
        const listed = {};
        for (const f of files) {
            const cache = app.metadataCache.getFileCache(f);
            const byLine = {};
            for (const t of cache?.tags ?? []) (byLine[t.position.start.line] ??= []).push(t.tag.slice(1));
            lineTags[f.path] = byLine;
            const one = Object.create(app.metadataCache);
            one.iterateFileCache = (each) => each(f.path, cache);
            listed[f.path] = Object.keys(one.getTags()).map(tag => tag.slice(1));
        }
        return JSON.stringify({ rows, lineTags, listed });
    })()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as Seen;
}

const sorted = (tags: readonly string[]) => [...new Set(tags)].sort();
/** Tags as `getTags()` counts them: each with the tags above it, a trailing `/` dropped, case aside. */
const asListed = (tags: readonly string[]) => sorted(tags.flatMap(tag => TagRule.withParents(tag)).map(TagRule.key));

beforeAll(async () => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
    for (const [name, content] of Object.entries(NOTES)) await writeIndexedTestFile(path(name), content);
});

afterAll(async () => {
    for (const name of Object.keys(NOTES)) deleteTestFile(path(name));
    for (const name of Object.keys(NOTES)) await waitForFileDeindexed(path(name));
});

describe('the tags of a row, against Obsidian', () => {
    it('are the tags Obsidian reads on the row\'s line', () => {
        const { rows, lineTags } = seen();
        const lineRows = rows.filter(r => Object.keys(LINE_NOTES).map(path).includes(r.file));
        // Every line is a row: none is lost to a reading the notation upsets.
        const lines = Object.values(LINE_NOTES).reduce((n, note) => n + note.split('\n').filter(line => line.startsWith('- [ ]')).length, 0);
        expect(lineRows).toHaveLength(lines);
        const differ = lineRows
            .map(r => ({ row: r.content, plugin: sorted(r.tags), obsidian: sorted(lineTags[r.file]?.[r.line] ?? []) }))
            .filter(d => JSON.stringify(d.plugin) !== JSON.stringify(d.obsidian));
        expect(differ).toEqual([]);
    });

    it('are, over a note, the tags Obsidian lists of it', () => {
        const { rows, listed } = seen();
        for (const name of Object.keys(LINE_NOTES)) {
            const plugin = asListed(rows.filter(r => r.file === path(name)).flatMap(r => r.tags));
            expect(plugin, name).toEqual(sorted(listed[path(name)].map(TagRule.key)));
        }
    });

    it('take from the frontmatter the tags Obsidian lists of it', () => {
        const { rows, listed } = seen();
        for (const [name, { listed: expected }] of Object.entries(FRONTMATTERS)) {
            const obsidian = sorted(listed[path(name)].map(TagRule.key));
            // The spec as found: a change here is Obsidian's, and the plugin follows it.
            expect(obsidian, `Obsidian, ${name}`).toEqual(sorted(expected));
            const row = rows.filter(r => r.file === path(name));
            expect(row, name).toHaveLength(1);
            expect(asListed(row[0].cascade), `plugin, ${name}`).toEqual(obsidian);
        }
    });
});
