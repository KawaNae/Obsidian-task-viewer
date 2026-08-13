import { describe, expect, it } from 'vitest';
import { decideTimerStartMode } from '../../../src/timer/TimerStartMode';

/**
 * 完了済みタスクへの開始だけダイアログを挟む。判定に使ってよいのは `statusChar`
 * だけ — v1 は「アイコン + 時刻 + [x]」という**形**で見分けようとして、手書きの
 * 行と区別できずに事故った。ここはその再発を止める番人。
 */
describe('decideTimerStartMode', () => {
    it('完了済み [x] は訊く', () => {
        expect(decideTimerStartMode('x')).toBe('ask');
    });

    it('未完了 [ ] は即時開始', () => {
        expect(decideTimerStartMode(' ')).toBe('immediate');
    });

    it('statusChar が無い（daily など）ときは即時開始', () => {
        expect(decideTimerStartMode(undefined)).toBe('immediate');
    });

    it('設定上は完了扱いの記号でも訊かない — [x] だけが基準', () => {
        // '-'(Cancelled) と '!'(Important) は既定で isComplete=true だが、
        // 「タイマーが記録を書き終えた行」の意味を持つのは [x] だけ。挿入位置を
        // 決める書き込み層（afterCompletedRun）も [x] しか見ないので、ここで
        // 広げると両者の見ている「完了」がずれる。
        for (const statusChar of ['-', '!', '/', '>', 'X']) {
            expect(decideTimerStartMode(statusChar)).toBe('immediate');
        }
    });
});
