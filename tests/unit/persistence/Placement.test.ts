import { describe, expect, it } from 'vitest';
import { Placement } from '../../../src/services/persistence/utils/Placement';

describe('Placement.groupHead', () => {
    describe('a row that is not indented', () => {
        it('is its own head below a heading', () => {
            expect(Placement.groupHead(['## Tasks', '- [ ] first', '- [ ] second'], 2)).toBe(1);
        });

        it('climbs the tasks just above it', () => {
            expect(Placement.groupHead(['## Tasks', '- [x] older', '- [x] middle', '- [ ] current'], 3)).toBe(1);
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
            expect(Placement.groupHead(lines, 5)).toBe(1);
        });

        it('stops at a blank line between two siblings', () => {
            expect(Placement.groupHead(['- [x] unrelated', '', '- [x] group start', '- [ ] current'], 3)).toBe(2);
        });

        it('is line 0 when it is the whole note', () => {
            expect(Placement.groupHead(['- [ ] only task'], 0)).toBe(0);
        });

        // CY1: the rows the walk used to take for siblings.
        it('does not go into the fence just above it', () => {
            const lines = ['# note', '```', '- [ ] sample', '```', '- [ ] current'];
            expect(Placement.groupHead(lines, 4)).toBe(4);
        });

        it('does not go into a tilde fence, or past a task line inside it', () => {
            const lines = ['- [ ] before', '~~~', '- [ ] sample', '~~~', '- [ ] current'];
            expect(Placement.groupHead(lines, 4)).toBe(4);
        });

        it('does not take a task line inside a fence whose closing line is indented', () => {
            // The indented closer reads as deeper than the row, so the walk
            // passes it and meets the fenced task line on the way up.
            const lines = ['# note', '```', '- [ ] sample', '  ```', '- [ ] current'];
            expect(Placement.groupHead(lines, 4)).toBe(4);
        });

        it('does not go above the frontmatter when it is the first line of the body', () => {
            const lines = ['---', 'tv-color: ff0000', '---', '- [ ] current', '\t- [ ] child'];
            expect(Placement.groupHead(lines, 3)).toBe(3);
        });

        it('climbs siblings up to the frontmatter and no further', () => {
            const lines = ['---', 'tags: a', '---', '- [x] first', '- [ ] current'];
            expect(Placement.groupHead(lines, 4)).toBe(3);
        });

        it('stops at a --- rule', () => {
            expect(Placement.groupHead(['- [x] above', '---', '- [ ] current'], 2)).toBe(2);
        });

        it('stops at a paragraph', () => {
            expect(Placement.groupHead(['Some text', '- [ ] current'], 1)).toBe(1);
        });

        it('stops at a table', () => {
            expect(Placement.groupHead(['| a | b |', '| - | - |', '| 1 | 2 |', '- [ ] current'], 3)).toBe(3);
        });

        it('stops at a list item that is not a task', () => {
            expect(Placement.groupHead(['- note', '- [ ] current'], 1)).toBe(1);
        });

        it('stops at a paragraph whose continuation is indented', () => {
            expect(Placement.groupHead(['paragraph', '    deeper text', '- [ ] current'], 2)).toBe(2);
        });
    });

    describe('a row that is indented', () => {
        it('goes just below its parent', () => {
            expect(Placement.groupHead(['- [ ] parent', '    - [x] child1', '    - [ ] child2'], 2)).toBe(1);
        });

        it('goes just below its parent past other siblings', () => {
            const lines = ['- [ ] parent', '    - [x] child1', '    - [x] child2', '    - [ ] child3'];
            expect(Placement.groupHead(lines, 3)).toBe(1);
        });

        it('takes a sibling indented by a tab for a sibling, not a parent', () => {
            // A tab and four spaces are the same depth: `a` is `current`'s elder
            // sibling, and the group's head is under `parent`.
            const lines = ['- [ ] parent', '\t- [x] a', '    - [ ] current'];
            expect(Placement.groupHead(lines, 2)).toBe(1);
        });

        it('goes below its parent over a blank line, not to the top of the note', () => {
            const lines = ['---', 'tags: a', '---', '# note', '- [ ] parent', '', '    - [ ] current'];
            expect(Placement.groupHead(lines, 6)).toBe(5);
        });

        it('goes below the frontmatter when nothing above it is shallower', () => {
            const lines = ['---', 'tags: a', '---', '', '    - [ ] current'];
            expect(Placement.groupHead(lines, 4)).toBe(3);
        });
    });
});

describe('Placement.end', () => {
    it('is the index of the trailing empty element of a terminated file', () => {
        expect(Placement.end(['a', ''])).toBe(1);
    });

    it('follows the last line of an unterminated file', () => {
        expect(Placement.end(['a'])).toBe(1);
    });

    it('is 0 for an empty file', () => {
        expect(Placement.end([''])).toBe(0);
    });

    it('is null when the note ends inside an unclosed fence', () => {
        expect(Placement.end(['text', '```', 'code', ''])).toBeNull();
    });

    it('is past a fence that closes at the end', () => {
        expect(Placement.end(['```', 'x', '```', ''])).toBe(3);
    });
});

describe('Placement.inBody', () => {
    it('refuses above the end of the frontmatter', () => {
        const lines = ['---', 'a: 1', '---', 'body'];
        expect(Placement.inBody(lines, 0)).toBeNull();
        expect(Placement.inBody(lines, 2)).toBeNull();
        expect(Placement.inBody(lines, 3)).toBe(3);
    });

    it('refuses inside a fence and allows either side of it', () => {
        const lines = ['text', '```', 'code', '```', 'text'];
        expect(Placement.inBody(lines, 1)).toBe(1);
        expect(Placement.inBody(lines, 2)).toBeNull();
        expect(Placement.inBody(lines, 3)).toBeNull();
        expect(Placement.inBody(lines, 4)).toBe(4);
    });

    it('refuses anywhere past a fence that never closes', () => {
        const lines = ['text', '```', 'code'];
        expect(Placement.inBody(lines, 1)).toBe(1);
        expect(Placement.inBody(lines, 3)).toBeNull();
    });

    it('reads a first line of --- that nothing closes as body', () => {
        expect(Placement.inBody(['---', '- [ ] a'], 0)).toBe(0);
    });
});
