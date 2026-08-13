import { describe, expect, it } from 'vitest';
import en from '../../../src/i18n/locales/en.json';
import ja from '../../../src/i18n/locales/ja.json';

/**
 * ウィジェットのボタンラベルは i18n キー経由でしか出さない。キーが片方の
 * ロケールにしか無いと、その言語だけ空ラベルのボタンが出る（アイコンだけの
 * ボタンに見えて何のボタンか分からなくなる）。
 */
const BUTTON_LABEL_KEYS = ['start', 'stop', 'resume', 'pause', 'suspend', 'finish', 'suspended'] as const;

const locales: Record<string, Record<string, string>> = {
    en: (en as { timer: Record<string, string> }).timer,
    ja: (ja as { timer: Record<string, string> }).timer,
};

describe('timer widget button labels', () => {
    for (const [name, table] of Object.entries(locales)) {
        it(`${name} defines every button label key`, () => {
            for (const key of BUTTON_LABEL_KEYS) {
                expect(table[key], `timer.${key} missing in ${name}`).toBeTruthy();
            }
        });
    }

    it('keeps the two locales in sync across the whole timer namespace', () => {
        expect(Object.keys(locales.ja).sort()).toEqual(Object.keys(locales.en).sort());
    });

    it('does not repurpose timer.complete as a button label', () => {
        // 'Timer complete!' は完了通知の文言。PR-D の ✓ 完了ボタンには
        // 別キーを起こすこと（流用するとボタンに文が出る）。
        expect(locales.en.complete).toMatch(/!$/);
    });
});
