/**
 * The reading of what `obsidian eval` printed (tests/integration/helpers/
 * eval-output.ts). Each output below is one the CLI of Obsidian 1.14.5 on
 * macOS printed for the code beside it, trimmed as the CLI helper trims it.
 */
import { describe, expect, it } from 'vitest';
import { readEvalOutput } from '../../integration/helpers/eval-output';

describe('an output of obsidian eval', () => {
    it('gives the value of a code that returns one, parsed when it is JSON', () => {
        // JSON.stringify({ a: 1 })
        expect(readEvalOutput('=> {"a":1}')).toEqual({ value: { a: 1 } });
        // 'ok'
        expect(readEvalOutput('=> ok')).toEqual({ value: 'ok' });
        // ({ a: 1, b: [2] }): an object is printed as JSON over several lines
        expect(readEvalOutput('=> {\n  "a": 1,\n  "b": [\n    2\n  ]\n}')).toEqual({ value: { a: 1, b: [2] } });
        // ''
        expect(readEvalOutput('=>')).toEqual({ value: '' });
        // null
        expect(readEvalOutput('=> null')).toEqual({ value: null });
    });

    it('gives the value after the lines the code wrote to the console', () => {
        // (console.log('l'), console.warn('w'), console.error('e'), JSON.stringify(true))
        expect(readEvalOutput('l\n[warn] w\n[error] e\n=> true')).toEqual({ value: true });
    });

    it('gives the error of a code that throws, and of one whose promise is rejected', () => {
        // (() => { throw new Error('boom'); })()
        expect(readEvalOutput('Error: boom')).toEqual({ error: 'Error: boom' });
        // Promise.reject(new Error('no'))
        expect(readEvalOutput('Error: no')).toEqual({ error: 'Error: no' });
        // Promise.reject('plain')
        expect(readEvalOutput('Error: plain')).toEqual({ error: 'Error: plain' });
    });

    it('gives the error of a code that writes to the console before it throws', () => {
        // (() => { console.warn('w'); console.log('l'); throw new Error('boom'); })()
        expect(readEvalOutput('[warn] w\nl\nError: boom')).toEqual({ error: 'Error: boom' });
        // (async () => { console.warn('w'); await new Promise(r => setTimeout(r, 10)); throw new Error('late'); })()
        expect(readEvalOutput('[warn] w\nError: late')).toEqual({ error: 'Error: late' });
    });

    it('gives an error message of several lines whole', () => {
        // (() => { throw new Error('one\ntwo'); })()
        expect(readEvalOutput('Error: one\ntwo')).toEqual({ error: 'Error: one\ntwo' });
    });

    it('gives the error of a code that throws what has no message, which Obsidian fails to read', () => {
        // (() => { throw null; })()
        expect(readEvalOutput("TypeError: Cannot read properties of null (reading 'message')")).toEqual({
            error: "the output has no value:\nTypeError: Cannot read properties of null (reading 'message')",
        });
    });

    it('takes no undefined as a success, whether the console was written or not', () => {
        // undefined
        expect(readEvalOutput('(no output)')).toEqual({ error: 'the code gave no value (undefined)' });
        // (console.log('l'), undefined)
        expect(readEvalOutput('l')).toEqual({ error: 'the output has no value:\nl' });
    });

    it('reads the last entry when a console line looks like one', () => {
        // (console.log('Error: logged'), JSON.stringify(1))
        expect(readEvalOutput('Error: logged\n=> 1')).toEqual({ value: 1 });
        // (() => { console.log('=> 1'); throw new Error('boom'); })()
        expect(readEvalOutput('=> 1\nError: boom')).toEqual({ error: 'Error: boom' });
    });
});
