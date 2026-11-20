/**
 * What each checkbox of markdowns of many shapes writes, in the running E2E
 * vault: every checkbox a card draws, pressed in turn, writes the line of
 * the word drawn on its item and no other line, or writes nothing and says
 * so. Which of them write nothing is listed (`WRITES_NOTHING`); every other
 * one writes. Which cards draw no checkbox is listed too (`DRAWS_NONE`);
 * every other one draws one at least.
 *
 * One note holds every markdown as a card of its own, under a `#` heading
 * that names it, and the frame shows the whole note. Each `@` of a markdown
 * is a word of its own in the note (`w<n>`), so a line is told by its word.
 * A shape that leaves a fence open is left out: it would hold the headings
 * below it.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault open, with the current build
 *     loaded (the preflight builds it into the vault)
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/markdown-frame-checkboxes.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Outline } from '../../../src/services/parsing/utils/Outline';
import { BLANK_STATUSES, BROAD_SHAPES, NAMED_STATUSES } from './markdown-frame-checkbox-shapes';
import { createTeardown } from '../helpers/teardown';
import { deleteNotesUnder } from '../helpers/markdown-frames';
import { boxCount, judged, pressEach, worded, writeNotes } from '../helpers/markdown-frame-presses';
import { closeViews, openView } from '../helpers/view-helper';

const PREFIX = 'test-int-mdboxes';
const NOTE = `${PREFIX}-broad`;
const PATH = `${NOTE}.md`;
const VIEW = 'mdboxes-tl';

/** The cards, each its heading's line and the markdown under it, words put in. */
const CARDS = (() => {
    let n = 0;
    return [...BROAD_SHAPES, ...BLANK_STATUSES, ...NAMED_STATUSES]
        .map(([name, markdown]) => {
            const [text, next] = worded(markdown, n);
            n = next;
            return { name, markdown: [`# ${name}`, text].join('\n') };
        })
        .filter(card => Outline.read([...card.markdown.split('\n'), '', '# next']).headings.length === 2);
})();
const TEXT = CARDS.flatMap(card => [card.markdown, '']).join('\n');

/**
 * The cards that draw no checkbox: what their markdown writes as a task
 * line is drawn as something else (code, math, a comment, HTML, a table
 * cell, a footnote not referred to), or is not a task line at all. Every
 * other card draws one at least.
 */
const DRAWS_NONE = new Set([
    'math-block', 'math-open-line', 'html-comment', 'html-comment-blank', 'html-div', 'html-span', 'html-pre',
    'table-cell', 'indented-code-top', 'indented-lazy', 'def-colon', 'quote-code', 'quote-tab', 'quote-space-tab',
    'fence-indented-3', 'fence-close-indent', 'comment-unclosed', 'num-interrupt', 'bracket-space-x',
    'five-space-marker', 'no-marker-gap', 'escaped', 'item-blank-start', 'footnote-noref', 'footnote-inline', 'nbsp',
    'html-entity-box', 'para-comment-fence', 'html-close-tag', 'quote-tab-callout', 'tilde-unclosed',
    'dollar-fence-like', 'nbsp-gap',
]);

/**
 * The checkboxes that write nothing, by their card and their place in it:
 * those written as HTML, which stand for no line of the card's markdown.
 */
const WRITES_NOTHING: Record<string, number[]> = {
    'html-li-named': [0],
    'html-li-named-aimed': [0],
    'html-li-plain': [0],
    'html-input-bare': [0],
};

const teardown = createTeardown();

beforeAll(() => {
    deleteNotesUnder(PREFIX);
    teardown.add('delete the notes', () => deleteNotesUnder(PREFIX));
    teardown.add('close the views', closeViews);
    writeNotes(PREFIX, { [PATH]: TEXT });
    openView(VIEW, 'timeline-view', { showSidebar: true, sidebar: [{ kind: 'markdown', id: 'broad', link: NOTE }] });
});

afterAll(() => teardown.run());

describe("a markdown frame's card's checkboxes, for markdowns of many shapes", () => {
    it('keeps most of the shapes', () => {
        expect(CARDS.length).toBeGreaterThan(BROAD_SHAPES.length * 0.9);
    });

    it.each(CARDS.map(card => card.name))('writes the line of the word drawn on each checkbox pressed in turn, or nothing, as listed: %s', (name) => {
        const count = boxCount(PREFIX, VIEW, 'broad', name);
        if (DRAWS_NONE.has(name)) expect(count).toBe(0);
        else expect(count).toBeGreaterThan(0);
        const presses = pressEach(PREFIX, VIEW, 'broad', name, PATH, [...Array(count).keys()]);
        const nothing = new Set(WRITES_NOTHING[name] ?? []);
        expect(presses.map(judged)).toEqual(presses.map((_p, i) => (nothing.has(i) ? 'nothing' : 'written')));
    });
});
