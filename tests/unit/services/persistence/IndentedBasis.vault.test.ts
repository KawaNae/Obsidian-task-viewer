import { describe, it, expect, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import { vaultSession, makeFile } from '../../helpers/vaultSession';

/**
 * The row's line is compared with its indentation (`readsAsPlanned`). The
 * indentation is part of the line: a row at another depth is not the row the
 * plan read, even where its text is the same.
 *
 * What that costs: an edit from outside that changes only a row's
 * indentation leaves the index's copy with the old one until the scan reads
 * the edit, and an update or a duplicate in that moment is refused (a delete
 * was already, as it compares the subtree verbatim). After the scan, the
 * copy has the new indentation and the operation goes through.
 */
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { },
    addEventListener: () => { }, removeEventListener: () => { },
};
const FILE = 'notes/a.md';

const SHAPES = [
    { name: 'a tab made four spaces', from: ['- [ ] P', '\t- [ ] A', ''], to: ['- [ ] P', '    - [ ] A', ''] },
    { name: 'four spaces made a tab', from: ['- [ ] P', '    - [ ] A', ''], to: ['- [ ] P', '\t- [ ] A', ''] },
    { name: 'indented under the row above', from: ['- [ ] P', '- [ ] A', ''], to: ['- [ ] P', '\t- [ ] A', ''] },
    { name: 'outdented', from: ['- [ ] P', '\t- [ ] A', ''], to: ['- [ ] P', '- [ ] A', ''] },
];

async function over(from: string[]) {
    const contents = new Map([[FILE, from.join('\n')]]);
    const s = vaultSession(contents);
    await s.scanAll();
    const id = s.index.getTasks().find(t => t.content === 'A')!.id;
    return { s, contents, id };
}

describe('a row whose indentation alone was changed from outside', () => {
    beforeEach(() => { Notice.messages.length = 0; });

    for (const shape of SHAPES) {
        for (const op of ['update', 'duplicate'] as const) {
            it(`${shape.name}: a ${op} before the scan is refused once, and goes through after it`, async () => {
                const { s, contents, id } = await over(shape.from);
                // Landed, and not read yet.
                contents.set(FILE, shape.to.join('\n'));

                const write = () => op === 'update'
                    ? s.index.updateTask(id, { statusChar: 'x' })
                    : s.index.duplicateTask(id);
                expect(await write()).toBe(false);
                expect(contents.get(FILE)).toBe(shape.to.join('\n'));
                expect(Notice.messages).toHaveLength(1);

                await s.fireVault('modify', makeFile(FILE));
                await s.settle(FILE);
                const again = s.index.getTasks().find(t => t.content === 'A')!.id;
                expect(await (op === 'update'
                    ? s.index.updateTask(again, { statusChar: 'x' })
                    : s.index.duplicateTask(again))).toBe(true);
                s.dispose();
            });
        }
    }

    it('keeps its indentation when an update goes through', async () => {
        const { s, contents, id } = await over(['- [ ] P', '\t- [ ] A', '']);
        expect(await s.index.updateTask(id, { statusChar: 'x' })).toBe(true);
        expect(contents.get(FILE)).toBe(['- [ ] P', '\t- [x] A', ''].join('\n'));
        s.dispose();
    });
});
