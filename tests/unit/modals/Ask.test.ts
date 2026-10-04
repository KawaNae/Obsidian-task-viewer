import { describe, it, expect } from 'vitest';
import { ask, type AskHands, type AskShell } from '../../../src/modals/ask/Ask';
import { CloseGate, type CloseAnswer } from '../../../src/views/sharedUI/CloseGate';
import type { OverlayOpenOpts } from '../../../src/views/sharedUI/OverlayShell';

/**
 * A question's answer, given once whichever way its dialog closes.
 *
 * The shell is a stand-in for OverlayShell that keeps its rules: the close
 * button, Escape, the back, a click outside and a swipe all ask to close
 * through the gate (`requestClose`), which asks the body (`beforeClose`);
 * however it closes, `onClose` is called once. The body is drawn on no
 * DOM: the test holds the hands the question gives it.
 */
class StandInShell implements AskShell {
    opts: OverlayOpenOpts | null = null;
    onCloses = 0;
    private readonly gate = new CloseGate({
        isOpen: () => this.opts !== null,
        ask: () => this.opts?.beforeClose?.() ?? 'close',
        close: () => this.close(),
    });

    open(opts: OverlayOpenOpts): void {
        this.opts = opts;
        this.gate.reset();
        opts.build({} as HTMLElement);
    }

    close(): void {
        const opts = this.opts;
        if (!opts) return;
        this.opts = null;
        this.gate.reset();
        this.onCloses++;
        opts.onClose?.();
    }

    requestClose(): Promise<boolean> {
        return this.gate.request();
    }

    // The ways the user closes it, as OverlayShell routes them.
    closeButton(): Promise<boolean> { return this.requestClose(); }
    escape(): Promise<boolean> { return this.requestClose(); }
    back(): Promise<boolean> { return this.requestClose(); }
    outside(): Promise<boolean> { return this.requestClose(); }
}

/** Open a question on a stand-in shell; hold its hands and count its answers. */
function setUp(beforeClose?: () => CloseAnswer) {
    const shell = new StandInShell();
    let hands!: AskHands<'yes' | 'no'>;
    const answers: string[] = [];
    const answered = ask<'yes' | 'no'>(shell, {
        keymap: {} as OverlayOpenOpts['keymap'],
        draw: (_el, given) => {
            hands = given;
            return { focus: null, beforeClose };
        },
    }).then((a) => { answers.push(a); return a; });
    return { shell, hands, answers, answered };
}

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('ask', () => {
    for (const way of ['closeButton', 'escape', 'back', 'outside'] as const) {
        it(`answers 'cancel' once when closed by ${way}, however often it is asked again`, async () => {
            const { shell, answers, answered } = setUp();
            await shell[way]();
            await shell[way]();
            shell.close();
            expect(await answered).toBe('cancel');
            await settle();
            expect(answers).toEqual(['cancel']);
            expect(shell.onCloses).toBe(1);
        });
    }

    it('answers \'cancel\' from the cancel button, through the same gate', async () => {
        const { shell, hands, answers } = setUp();
        hands.cancel();
        await settle();
        expect(answers).toEqual(['cancel']);
        expect(shell.onCloses).toBe(1);
    });

    it('answers the choice given first and closes, and nothing given after it or a close counts', async () => {
        const { shell, hands, answers } = setUp();
        hands.answer('yes');
        hands.answer('no');
        await shell.escape();
        hands.cancel();
        await settle();
        expect(answers).toEqual(['yes']);
        expect(shell.onCloses).toBe(1);
    });

    it('answers nothing while the body keeps it open, and \'cancel\' once a close it waited for goes', async () => {
        let resolve!: (v: 'close' | 'stay') => void;
        const waiting = new Promise<'close' | 'stay'>((res) => { resolve = res; });
        const { shell, answers } = setUp(() => waiting);
        const first = shell.escape();
        const second = shell.outside();
        await settle();
        expect(answers).toEqual([]);
        resolve('close');
        expect(await first).toBe(true);
        expect(await second).toBe(true);
        await settle();
        expect(answers).toEqual(['cancel']);
        expect(shell.onCloses).toBe(1);
    });

    it('stays open with no answer when the body says stay, and answers what is given later', async () => {
        const { shell, hands, answers } = setUp(() => 'stay');
        expect(await shell.closeButton()).toBe(false);
        await settle();
        expect(answers).toEqual([]);
        hands.answer('no');
        await settle();
        expect(answers).toEqual(['no']);
    });
});
