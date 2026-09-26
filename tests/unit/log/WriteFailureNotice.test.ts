import { describe, it, expect, afterEach } from 'vitest';
import { TFile } from 'obsidian';
import { initLog, logError } from '../../../src/log/log';
import { processLines, type Refusal } from '../../../src/services/persistence/FileLines';
import { channelDouble } from '../helpers/channelDouble';

/**
 * A write that failed is told once, by its refusal (`TaskIndex.reportRefusal`).
 * The log line behind it is kept, but not shown as a notice of its own: on
 * Dev, a thrown write showed two, the log line and the refusal.
 */

const shown: string[] = [];

afterEach(() => { shown.length = 0; });

function failingWrite() {
    const file = new TFile();
    file.path = 'note.md';
    const app = {
        vault: {
            process: async () => { throw new Error('write failed'); },
            read: async () => '- [ ] a\n',
        },
    } as never;
    const refusals: Refusal[] = [];
    const channel = channelDouble({ refused: (refusal) => { refusals.push(refusal); } });
    return { app, file, channel, refusals };
}

describe('a write that failed', () => {
    it('is told once, by the refusal, and the log shows no notice of its own', async () => {
        initLog(() => ({ verboseNotice: false }), (message) => { shown.push(message); });
        const w = failingWrite();

        const outcome = await processLines(w.app, w.file, w.channel, (draft) => {
            draft.rewrite(0, '- [x] a');
            return true;
        });

        expect(outcome.written).toBe(false);
        expect(w.refusals).toHaveLength(1);
        expect(shown).toEqual([]);
    });

    it('leaves other errors shown as before', () => {
        initLog(() => ({ verboseNotice: false }), (message) => { shown.push(message); });
        logError('something else broke');
        expect(shown).toEqual(['something else broke']);
    });
});
