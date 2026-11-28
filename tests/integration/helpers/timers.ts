import { obsidianEval } from './cli-helper';

/**
 * Close every timer on the board without recording it, and wait until the
 * board is empty: the cleanup after each test that starts a timer.
 *
 * Every timer is closed, not only the one the test was answered: the CLI
 * call that starts a timer can time out after the timer started, and the
 * test is then never told its id. A timer left open stays on the board and
 * in the plugin's saved state, and a later test sees it (one on the same
 * daily note keeps another from starting).
 *
 * A timer still writing its first line is waited for, since a close that
 * comes while a write is on its way is dropped. Throws, naming them, when
 * timers are still open after 10 s, or when the call did not answer.
 */
export function closeEveryTimer(): void {
    const answer = obsidianEval(`(async () => {
        const widget = app.plugins.plugins['obsidian-task-viewer'].getTimerWidget();
        const end = Date.now() + 10000;
        while (widget.board.values().length > 0 && Date.now() < end) {
            for (const timer of widget.board.values()) {
                if (!timer.opening) await widget.lifecycle.close(timer);
            }
            await new Promise(r => setTimeout(r, 100));
        }
        await new Promise(r => setTimeout(r, 500));
        return JSON.stringify(widget.board.values().map(t => t.id));
    })()`);
    if (!Array.isArray(answer)) {
        throw new Error(`the timers could not be closed: ${JSON.stringify(answer)}`);
    }
    if (answer.length > 0) throw new Error(`timers still open after 10 s: ${answer.join(', ')}`);
}
