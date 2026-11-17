/**
 * What `obsidian eval` printed, read as the value the code gave or the error
 * it ended with. Nothing here asks Obsidian, so the reading is tried on the
 * CLI's outputs as they were seen (tests/unit/e2e/eval-output.test.ts).
 *
 * The output is the console lines written while the code ran, then one
 * entry for how it ended: `=> ` and the value, `Error: ` and the message of
 * what was thrown or rejected, or nothing at all when the value was
 * undefined (the whole output is then `(no output)` if no line was
 * written). The CLI exits with 0 whichever it is. When what was thrown has
 * no `message` to read (`throw null`), the reading of it throws in
 * Obsidian, and the output is that error alone, with no `Error: ` before
 * it. The console lines are every line written in the window while a
 * Promise of the code was waited for, the plugin's own warnings among them,
 * and a `console.log` line has no prefix; so the console lines say nothing
 * about how the code ended, and only the last entry is read.
 *
 * An output with no value is not taken as a success: the code under test
 * returns a value when it ends as meant (a snippet's `return 'ok'`), so an
 * output without one is a snippet that did not reach its end, or one the
 * CLI printed otherwise than read here.
 */

export type EvalOutcome = { value: unknown } | { error: string };

const VALUE = '=> ';
const ERROR = 'Error: ';

/** Whether `line` opens the entry `prefix` opens; a value or a message that is empty leaves the prefix without its space once the output is trimmed. */
function opens(line: string, prefix: string): boolean {
    return line.startsWith(prefix) || line === prefix.trimEnd();
}

/**
 * The value or the error of an output of `obsidian eval` (trimmed, as the
 * CLI helper reads it). The last entry is the one opened by the last line
 * that starts with `=> ` or `Error: `, and runs to the end, since a value
 * an object prints as JSON over several lines and a message may hold
 * several. A value that is JSON comes back parsed.
 *
 * A value or a message holding a line that starts so is read from that line
 * on. A line `Error: ` then reads a value as an error, which a test sees;
 * only a message holding a line `=> ` reads as a value.
 */
export function readEvalOutput(raw: string): EvalOutcome {
    const lines = raw.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (opens(line, VALUE)) {
            const text = [line.slice(VALUE.length), ...lines.slice(i + 1)].join('\n');
            try {
                return { value: JSON.parse(text) };
            } catch {
                return { value: text };
            }
        }
        if (opens(line, ERROR)) return { error: lines.slice(i).join('\n') };
    }
    return {
        error: raw === '(no output)'
            ? 'the code gave no value (undefined)'
            : `the output has no value:\n${raw}`,
    };
}
