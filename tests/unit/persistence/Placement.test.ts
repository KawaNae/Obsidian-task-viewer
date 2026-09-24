import { describe, expect, it } from 'vitest';
import { Placement } from '../../../src/services/persistence/utils/Placement';

describe('Placement.groupHead', () => {
    describe('a row that is not indented', () => {
        it('is its own head below a heading', () => {
            expect(Placement.groupHead(['## Tasks', '- [ ] first', '- [ ] second'], 2, '- [ ] n').at).toBe(1);
        });

        it('climbs the tasks just above it', () => {
            expect(Placement.groupHead(['## Tasks', '- [x] older', '- [x] middle', '- [ ] current'], 3, '- [ ] n').at).toBe(1);
        });

        it('climbs over the children of the siblings above', () => {
            const lines = [
                '## Tasks',
                '- [x] sibling1',
                '    - [x] child of sibling1',
                '    - [x] another child',
                '- [x] sibling2',
                '- [ ] current',
            ];
            expect(Placement.groupHead(lines, 5, '- [ ] n').at).toBe(1);
        });

        it('stops at a blank line between two siblings', () => {
            expect(Placement.groupHead(['- [x] unrelated', '', '- [x] group start', '- [ ] current'], 3, '- [ ] n').at).toBe(2);
        });

        it('is line 0 when it is the whole note', () => {
            expect(Placement.groupHead(['- [ ] only task'], 0, '- [ ] n').at).toBe(0);
        });

        // CY1: the rows the walk used to take for siblings.
        it('does not go into the fence just above it', () => {
            const lines = ['# note', '```', '- [ ] sample', '```', '- [ ] current'];
            expect(Placement.groupHead(lines, 4, '- [ ] n').at).toBe(4);
        });

        it('does not go into a tilde fence, or past a task line inside it', () => {
            const lines = ['- [ ] before', '~~~', '- [ ] sample', '~~~', '- [ ] current'];
            expect(Placement.groupHead(lines, 4, '- [ ] n').at).toBe(4);
        });

        it('does not take a task line inside a fence whose closing line is indented', () => {
            // The indented closer reads as deeper than the row, so the walk
            // passes it and meets the fenced task line on the way up.
            const lines = ['# note', '```', '- [ ] sample', '  ```', '- [ ] current'];
            expect(Placement.groupHead(lines, 4, '- [ ] n').at).toBe(4);
        });

        it('does not go above the frontmatter when it is the first line of the body', () => {
            const lines = ['---', 'tv-color: ff0000', '---', '- [ ] current', '\t- [ ] child'];
            expect(Placement.groupHead(lines, 3, '- [ ] n').at).toBe(3);
        });

        it('climbs siblings up to the frontmatter and no further', () => {
            const lines = ['---', 'tags: a', '---', '- [x] first', '- [ ] current'];
            expect(Placement.groupHead(lines, 4, '- [ ] n').at).toBe(3);
        });

        it('stops at a --- rule', () => {
            expect(Placement.groupHead(['- [x] above', '---', '- [ ] current'], 2, '- [ ] n').at).toBe(2);
        });

        it('stops at a paragraph', () => {
            expect(Placement.groupHead(['Some text', '- [ ] current'], 1, '- [ ] n').at).toBe(1);
        });

        it('stops at a table', () => {
            expect(Placement.groupHead(['| a | b |', '| - | - |', '| 1 | 2 |', '- [ ] current'], 3, '- [ ] n').at).toBe(3);
        });

        it('stops at a list item that is not a task', () => {
            expect(Placement.groupHead(['- note', '- [ ] current'], 1, '- [ ] n').at).toBe(1);
        });

        it('stops at a paragraph whose continuation is indented', () => {
            expect(Placement.groupHead(['paragraph', '    deeper text', '- [ ] current'], 2, '- [ ] n').at).toBe(2);
        });
    });

    describe('a row that is indented', () => {
        it('goes just below its parent', () => {
            expect(Placement.groupHead(['- [ ] parent', '    - [x] child1', '    - [ ] child2'], 2, '- [ ] n').at).toBe(1);
        });

        it('goes just below its parent past other siblings', () => {
            const lines = ['- [ ] parent', '    - [x] child1', '    - [x] child2', '    - [ ] child3'];
            expect(Placement.groupHead(lines, 3, '- [ ] n').at).toBe(1);
        });

        it('takes a sibling indented by a tab for a sibling, not a parent', () => {
            // A tab and four spaces are the same depth: `a` is `current`'s elder
            // sibling, and the group's head is under `parent`.
            const lines = ['- [ ] parent', '\t- [x] a', '    - [ ] current'];
            expect(Placement.groupHead(lines, 2, '- [ ] n').at).toBe(1);
        });

        it('goes below its parent over a blank line, not to the top of the note', () => {
            const lines = ['---', 'tags: a', '---', '# note', '- [ ] parent', '', '    - [ ] current'];
            expect(Placement.groupHead(lines, 6, '- [ ] n').at).toBe(5);
        });

        it('is the row itself when it stands at the top with nothing above it but the frontmatter', () => {
            // Two columns in under nothing is an item at the top (Obsidian,
            // measurement.md q3; four would be indented code, q10), and a
            // blank line ends its run.
            const lines = ['---', 'tags: a', '---', '', '  - [ ] current'];
            expect(Placement.groupHead(lines, 4, '- [ ] n').at).toBe(4);
        });
    });
});

describe('Placement.afterSubtree', () => {
    it('is past the children, a blank line inside them included, and before the blank lines after', () => {
        const lines = ['- [ ] a', '\t- b', '', '\t- c', '', '- [ ] d'];
        expect(Placement.afterSubtree(lines, 0, '- [ ] n').at).toBe(4);
    });

    it('is past a fence in the subtree that never closes, which takes the shallow line below it (Obsidian, measurement.md q14)', () => {
        // `after` goes on a's fence, and a with it; a sibling put past it
        // starts an item, which ends both.
        const lines = ['- [ ] a', '  ```', '  x', 'after', ''];
        expect(Placement.afterSubtree(lines, 0, '- [ ] n').at).toBe(4);
    });

    it('answers where the rule lands even inside a fence at the top that never closes', () => {
        // The fence at column 0 ends a and holds every line after it, b's
        // subtree and the end of the note included. A line put there reads
        // as code, which the write's check refuses (`checkWrite`,
        // OutlineCheck.test.ts); where it lands is not refused here.
        const lines = ['- [ ] a', '```', 'x', '- [ ] b', ''];
        expect(Placement.afterSubtree(lines, 0, '- [ ] n').at).toBe(1);
        expect(Placement.afterSubtree(lines, 3, '- [ ] n').at).toBe(4);
        expect(Placement.end(lines).at).toBe(4);
    });
});

describe('Placement.firstChild', () => {
    it('is the line below the row, under it, at its children\'s indentation', () => {
        expect(Placement.firstChild(['- [ ] a', '\t- b'], 0, '- [ ] n')).toEqual({ at: 1, parent: 0, indent: '\t' });
    });

    it('is past the row\'s text that goes on, which a child put above it would take in (P1)', () => {
        // A paragraph going on (a lazy line), and one indented past the
        // content; both are the row's own text.
        expect(Placement.firstChild(['- [ ] a', 'lazy', '- [ ] b'], 0, '- [ ] n').at).toBe(2);
        expect(Placement.firstChild(['- [ ] a', '      deep', '  more', '- [ ] b'], 0, '- [ ] n').at).toBe(3);
        // Not past a blank line, a fence or a child: those start a block of
        // their own below the child put.
        expect(Placement.firstChild(['- [ ] a', '', '  para'], 0, '- [ ] n').at).toBe(1);
        expect(Placement.firstChild(['- [ ] a', '  ```', '  x', '  ```'], 0, '- [ ] n').at).toBe(1);
        expect(Placement.firstChild(['- [ ] a', 'text', '  - b'], 0, '- [ ] n').at).toBe(2);
    });
});

describe('Placement.lastChild', () => {
    it('is past the row\'s subtree, under the row, at its children\'s indentation', () => {
        expect(Placement.lastChild(['- [ ] a', '  - b', '    - c', '- [ ] d'], 0, '- [ ] n')).toEqual({ at: 3, parent: 0, indent: '  ' });
        // No child to copy: the file's unit, to the row's content column.
        expect(Placement.lastChild(['100. [ ] a', '- x', '\t- y'], 0, '- [ ] n')).toEqual({ at: 1, parent: 0, indent: '\t\t' });
    });
});

describe('Placement.before', () => {
    it('is the row\'s own line, as its sibling', () => {
        expect(Placement.before(['- [ ] p', '\t- [ ] a', '\t\t- c'], 1, '- [ ] n')).toEqual({ at: 1, parent: 0, indent: '\t' });
    });
});

describe('Placement.underHeading', () => {
    it('is just below the heading, at the top, unindented when no item follows', () => {
        expect(Placement.underHeading(['## H', '- [ ] a'], 0, '- [ ] n')).toEqual({ at: 1, parent: null, indent: '' });
        expect(Placement.underHeading(['## H'], 0, '- [ ] n')).toEqual({ at: 1, parent: null, indent: '' });
    });

    it('is at the indentation of the first item at the top below it, blank lines aside, as its sibling (P1)', () => {
        expect(Placement.underHeading(['## H', '', '  - [ ] a', '\t- [ ] b'], 0, '- [ ] n')).toEqual({ at: 1, parent: null, indent: '  ' });
    });

    it('is past the paragraph and the indented code below the heading, and not past the next heading', () => {
        expect(Placement.underHeading(['## H', 'para', 'more', '', '- [ ] a'], 0, '- [ ] n').at).toBe(3);
        // Four columns under a heading is indented code (measurement.md q10).
        expect(Placement.underHeading(['## H', '\t- [ ] a', '\t\t- [ ] b', '- [ ] c'], 0, '- [ ] n')).toEqual({ at: 3, parent: null, indent: '' });
        expect(Placement.underHeading(['## H', '### Sub', 'para'], 0, '- [ ] n').at).toBe(1);
        expect(Placement.underHeading(['## H', '---', 'para'], 0, '- [ ] n').at).toBe(1);
    });
});

describe('the spot\'s parent and indentation', () => {
    it('is the row\'s parent and the row\'s indentation for a sibling', () => {
        const lines = ['- [ ] p', '    - [x] a', '    - [ ] b', '- [ ] q'];
        expect(Placement.groupHead(lines, 2, '- [ ] n')).toEqual({ at: 1, parent: 0, indent: '    ' });
        expect(Placement.afterSubtree(lines, 1, '- [ ] n')).toEqual({ at: 2, parent: 0, indent: '    ' });
        expect(Placement.afterCompletedRun(lines, 1, '- [ ] n')).toEqual({ at: 2, parent: 0, indent: '    ' });
        expect(Placement.groupHead(lines, 3, '- [ ] n')).toEqual({ at: 0, parent: null, indent: '' });
        expect(Placement.end(lines)).toEqual({ at: 4, parent: null, indent: '' });
    });

    it('takes the spelling of the row it names, else of the item it goes above, else of the one it goes below', () => {
        const lines = ['- [ ] P', '\t- [ ] a', '    - [ ] b', '- [ ] q'];
        expect(Placement.afterSubtree(lines, 1, '- [ ] n')).toEqual({ at: 2, parent: 0, indent: '\t' });
        expect(Placement.groupHead(lines, 2, '- [ ] n')).toEqual({ at: 1, parent: 0, indent: '\t' });
        expect(Placement.lastChild(lines, 0, '- [ ] n')).toEqual({ at: 3, parent: 0, indent: '    ' });
        expect(Placement.before(lines, 1, '- [ ] n')).toEqual({ at: 1, parent: 0, indent: '\t' });
        expect(Placement.afterSubtree(lines, 2, '- [ ] n')).toEqual({ at: 3, parent: 0, indent: '    ' });
        // With neither next to it, a child's indentation of the parent.
        expect(Placement.groupHead(['- [ ] P', '  ```', '  ```', '\t- [ ] a'], 3, '- [ ] n')).toEqual({ at: 1, parent: 0, indent: '\t' });
    });

    it('puts a child next to the children there, as a sibling of theirs', () => {
        const lines = ['- [ ] T', '\t- [ ] a', '    - [ ] b', '- [ ] U'];
        expect(Placement.lastChild(lines, 0, '- [ ] n')).toEqual({ at: 3, parent: 0, indent: '    ' });
        expect(Placement.firstChild(lines, 0, '- [ ] n')).toEqual({ at: 1, parent: 0, indent: '\t' });
    });

    it('goes past the parent\'s own text that goes on, for the head of a group under it', () => {
        expect(Placement.groupHead(['- [ ] p', '  text', '  - [ ] a'], 2, '- [ ] n')).toEqual({ at: 2, parent: 0, indent: '  ' });
    });
});

describe('Placement.afterCompletedRun', () => {
    it('goes past the completed siblings that follow, and their children', () => {
        const lines = ['- [ ] a', '- [x] b', '\t- note', '- [x] c', '- [ ] d'];
        expect(Placement.afterCompletedRun(lines, 0, '- [ ] n').at).toBe(4);
    });

    it('is past the row\'s own subtree when the next sibling is not completed', () => {
        expect(Placement.afterCompletedRun(['- [ ] a', '\t- b', '- [ ] c'], 0, '- [ ] n').at).toBe(2);
    });

    it('stops at a blank line between siblings', () => {
        expect(Placement.afterCompletedRun(['- [ ] a', '- [x] b', '', '- [x] c'], 0, '- [ ] n').at).toBe(2);
    });

    it('takes a sibling indented by a tab and one by four spaces for the same depth', () => {
        const lines = ['- [ ] p', '\t- [ ] a', '    - [x] b', '\t- [x] c', '- [ ] q'];
        expect(Placement.afterCompletedRun(lines, 1, '- [ ] n').at).toBe(4);
    });
});

describe('Placement.end', () => {
    it('is the index of the trailing empty element of a terminated file', () => {
        expect(Placement.end(['a', '']).at).toBe(1);
    });

    it('follows the last line of an unterminated file', () => {
        expect(Placement.end(['a']).at).toBe(1);
    });

    it('is 0 for an empty file', () => {
        expect(Placement.end(['']).at).toBe(0);
    });

    it('is past the last line even when the note ends inside an unclosed fence (the check refuses what is put there)', () => {
        expect(Placement.end(['text', '```', 'code', '']).at).toBe(3);
    });

    it('is past the frontmatter of a note that is nothing else', () => {
        expect(Placement.end(['---', 'a: 1', '---', '']).at).toBe(3);
        expect(Placement.end(['---', 'a: 1', '---']).at).toBe(3);
    });

    it('is past a fence that closes at the end', () => {
        expect(Placement.end(['```', 'x', '```', '']).at).toBe(3);
    });
});

// Whether a line put at a spot is in the body, and outside code, is not
// asked here any more: it is read off the lines as written
// (`checkWrite`, OutlineCheck.test.ts, and the shapes the old
// `Placement.inBody` refused are there).
