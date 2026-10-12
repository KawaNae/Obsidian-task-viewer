/**
 * Writes the readings in `tests/unit/parsing/fixtures/commonmark-outline.json`:
 * what CommonMark (commonmark.js, the version pinned in package.json) reads
 * of each shape's `lines`.
 *
 * The fixture holds the shapes; this script reads each shape's `lines` from
 * it and writes over `items`, `owners` and `blank`. To add a shape, add its
 * name and `lines` to the fixture and run:
 *
 *     node tests/tools/commonmark-outline-fixture.mjs
 *
 * - `items`: per list item, `[line, end, parent]`: its first line, just past
 *   its last line that is not blank, and the line of the item it stands in.
 * - `owners`: per line, the innermost item it stands in; null for a blank
 *   line or a line in no item.
 * - `blank`: for a shape with a line of only NBSP or U+3000 (with spaces and
 *   tabs), the same reading with those lines read as blank, as the outline
 *   reads them.
 *
 * Lines are 0-indexed.
 *
 * A shape's name starts with its group: A to I for the shapes measured in
 * Obsidian 1.12.4, X for those added after, NB for a line of only NBSP (`n`)
 * or U+3000 (`i`). In the rest, `s<n>` is n spaces, `t` a tab and `S<n>t`
 * n spaces before a tab.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Parser } from 'commonmark';

const FIXTURE = fileURLToPath(new URL('../unit/parsing/fixtures/commonmark-outline.json', import.meta.url));
const VERSION = JSON.parse(readFileSync(new URL('../../node_modules/commonmark/package.json', import.meta.url), 'utf8')).version;

/** A blank line to CommonMark: spaces and tabs only. */
const isBlank = line => /^[ \t]*$/.test(line);
/** A line the outline reads as blank and CommonMark does not. */
const isWideBlank = line => /^[ \t 　]*$/.test(line) && !isBlank(line);

function read(lines) {
    const doc = new Parser().parse(lines.join('\n'));
    const found = [];
    const walker = doc.walker();
    let event;
    while ((event = walker.next())) {
        const node = event.node;
        if (!event.entering || node.type !== 'item') continue;
        let parent = node.parent;
        while (parent && parent.type !== 'item') parent = parent.parent;
        const line = node.sourcepos[0][0] - 1;
        let last = node.sourcepos[1][0] - 1;
        while (last > line && isBlank(lines[last])) last--;
        found.push({ line, end: last + 1, parent: parent ? parent.sourcepos[0][0] - 1 : null });
    }
    found.sort((a, b) => a.line - b.line);
    const items = found.map(i => [i.line, i.end, i.parent]);
    const owners = lines.map((text, n) => {
        if (isBlank(text)) return null;
        let owner = null;
        for (const i of found) if (i.line <= n && n < i.end) owner = i.line;
        return owner;
    });
    return { items, owners };
}

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const shapes = Object.entries(fixture.shapes).map(([name, { lines }]) => {
    const shape = { lines, ...read(lines) };
    if (lines.some(isWideBlank)) shape.blank = read(lines.map(l => (isWideBlank(l) ? '' : l)));
    return `    ${JSON.stringify(name)}: ${JSON.stringify(shape)}`;
});
const head = {
    generator: 'tests/tools/commonmark-outline-fixture.mjs',
    commonmark: `commonmark.js ${VERSION}`,
    note: 'owners: null for a blank line or a line in no item. Lines are 0-indexed.',
};
const headLines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
writeFileSync(FIXTURE, `{\n${headLines.join('\n')}\n  "shapes": {\n${shapes.join(',\n')}\n  }\n}\n`);
