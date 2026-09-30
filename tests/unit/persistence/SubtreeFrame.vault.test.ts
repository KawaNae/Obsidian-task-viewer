import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import { openLiveVault, type VaultSession } from '../helpers/vaultSession';
import { SubtreeFrame, type SubtreeDraft } from '../../../src/services/persistence/utils/SubtreeFrame';
import { indentUnit } from '../../../src/utils/ObsidianConfig';

/**
 * The source editor's frame over the index's subtree, written through the
 * index (`TaskIndex.replaceSubtree`): the lines the draft did not change land
 * in the note as they were.
 */

const FILE = 'note.md';

let live: VaultSession | undefined;
beforeEach(() => { Notice.messages.length = 0; });
afterEach(() => { live?.dispose(); live = undefined; });

async function open(lines: string[], config?: Record<string, unknown>) {
    const { contents, session } = await openLiveVault({ [FILE]: lines }, s => { live = s; }, { config });
    const idOf = (content: string) => session.index.getTasks().find(task => task.content === content)!.id;
    return {
        session,
        lines: () => contents.get(FILE)!.split('\n'),
        /** Open the row `content` as the hub does, and write what `edit` makes of the frame. */
        edit: async (content: string, edit: (frame: SubtreeFrame) => SubtreeDraft) => {
            const id = idOf(content);
            const base = session.index.getTask(id)!.subtreeLines!;
            const opening = SubtreeFrame.open(base, indentUnit(session.app));
            if (!opening.open) throw new Error('shut');
            const check = opening.frame.check(edit(opening.frame));
            if (check.kind !== 'write') return check;
            const answer = await session.ops.replaceSubtree(id, base, check.replacement);
            await session.flowSettled(FILE);
            return answer;
        },
    };
}

describe('a draft of a subtree, written to the note', () => {
    it('writes a nested row\'s subtree back at its depth, the lines not changed as they were', async () => {
        const note = await open(['- [ ] top', '\t- [ ] P', '\t  \t- [ ] a', '\t\t\t- [ ] b', '\t\t\t\t- memo:: x', '- [ ] after', '']);

        const answer = await note.edit('P', frame => {
            // The child indentation is a's, `\t  \t`; b's tabs do not start with
            // it, so the editor shows b at its columns past it, in spaces.
            expect(frame.children).toEqual(['- [ ] a', '    - [ ] b', '        - memo:: x']);
            return {
                parent: frame.parent,
                children: [
                    { text: frame.children[0], was: 1 },
                    { text: '    - [ ] b2', was: 2 },
                    { text: frame.children[2], was: 3 },
                    { text: '- [ ] c', was: null },
                ],
            };
        });

        expect(answer).toEqual({ written: true });
        expect(note.lines()).toEqual(['- [ ] top', '\t- [ ] P', '\t  \t- [ ] a', '\t\t\t- [ ] b2', '\t\t\t\t- memo:: x', '\t  \t- [ ] c', '- [ ] after', '']);
    });

    it('writes a first child at the new level the settings say', async () => {
        const note = await open(['- [ ] other', '\t- [ ] its child', '- [ ] P', ''], { useTab: false, tabSize: 4 });

        const answer = await note.edit('P', frame => ({ parent: frame.parent, children: [{ text: '- [ ] c', was: null }] }));

        expect(answer).toEqual({ written: true });
        expect(note.lines()).toEqual(['- [ ] other', '\t- [ ] its child', '- [ ] P', '    - [ ] c', '']);
    });

    it('writes nothing for a draft left as it opened', async () => {
        const note = await open(['- [ ] P', '    - [ ] a', '']);
        const answer = await note.edit('P', frame => ({ parent: frame.parent, children: frame.children.map((text, i) => ({ text, was: i + 1 })) }));
        expect(answer).toEqual({ kind: 'same' });
    });
});
