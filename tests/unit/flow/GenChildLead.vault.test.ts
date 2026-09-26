import { describe, it, expect, afterEach } from 'vitest';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import { TaskLineClassifier } from '../../../src/services/parsing/utils/TaskLineClassifier';

/**
 * A generation block's child line led by a full-width space (U+3000) or a
 * no-break space (U+00A0) after its indentation. Neither is indentation, so
 * the line reads as text, not a checkbox. The write takes off the same
 * indentation the reading does (`Outline.dedent`) and nothing more, so the
 * fire writes the text line the block describes.
 */
const FILE = 'note.md';
const LF = String.fromCharCode(10);

let live: VaultSession | undefined;
afterEach(() => { live?.dispose(); live = undefined; });

function idOf(session: VaultSession, content: string): string {
    const f = session.index.getTasks().filter(t => t.file === FILE && t.content === content);
    expect(f, content).toHaveLength(1);
    return f[0].id;
}

describe('gen child line led by U+3000 / NBSP after its indentation', () => {
    for (const [name, code] of [['U+3000', 0x3000], ['NBSP', 0xa0]] as const) {
        const lead = String.fromCharCode(code);
        it(`a fire does not write it as a checkbox line (${name})`, async () => {
            const templateChild = `\t${lead}- [ ] gen-child`;
            // The reading this stage set up: the body line is not a task line.
            expect(TaskLineClassifier.isTaskLine(templateChild)).toBe(false);

            const text = ['# note', '- [ ] target @2026-09-21', '\t- ==> every mon use("g")', '',
                '```tv-gen g', '- [ ] target', templateChild, '```', ''].join(LF);
            const contents = new Map([[FILE, text]]);
            live = vaultSession(contents);
            await live.scanAll();
            expect(live.index.getTasks().map(t => t.content)).toEqual(['target']);

            expect(await live.index.updateTask(idOf(live, 'target'), { statusChar: 'x' })).toBe(true);
            await live.flowSettled(FILE);

            const written = contents.get(FILE)!.split(LF);
            // What the block describes is a text line; a checkbox line is not what it holds.
            expect(written).not.toContain('\t- [ ] gen-child');
            expect(written).toContain(`\t${lead}- [ ] gen-child`);
            expect(live.index.getTasks().filter(t => t.content === 'gen-child')).toEqual([]);
        });
    }
});
