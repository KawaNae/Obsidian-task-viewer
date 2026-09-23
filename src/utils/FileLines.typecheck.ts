import type { App, TFile } from 'obsidian';
import { processLines, type WriteChannel } from './FileLines';

/**
 * Compile-time checks on how a write reaches the file. Nothing imports this
 * file, so it is never bundled; `tsc` reads it with the rest of `src` (the
 * build runs `tsc -noEmit` first), and a check that stops holding fails the
 * build.
 *
 * Each `@ts-expect-error` is the check: it is itself an error when the line
 * under it compiles. Together they say that a write cannot change the file
 * without the change being reported: the lines can only be changed through
 * the draft, which reports every change as it makes it.
 */
export function writeSignatureChecks(app: App, file: TFile, channel: WriteChannel | undefined): void {
    // A line assigned past the draft would be an edit nobody heard of.
    void processLines(app, file, channel, (draft) => {
        // @ts-expect-error the lines are read-only to the write
        draft.lines[0] = 'changed';
        return true;
    });

    // Nor can a write hand back lines of its own making: it says whether to
    // write, and what is written is what the draft holds.
    // @ts-expect-error the callback answers yes or no, not with lines
    void processLines(app, file, channel, (draft) => [...draft.lines]);

    // Leaving the channel out would leave out the report with it, so every
    // write names one, even when there is none to name.
    // @ts-expect-error the channel is not optional
    void processLines(app, file, () => true);
}
