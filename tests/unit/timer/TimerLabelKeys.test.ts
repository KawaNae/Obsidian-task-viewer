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
    en: (en as unknown as { timer: Record<string, string> }).timer,
    ja: (ja as unknown as { timer: Record<string, string> }).timer,
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

/**
 * 記録の通知は1つの文言で、種類の名前（Timer、Countdown、Pomodoro）を `{{kind}}` で
 * 受ける。メニューの文言は押した瞬間に始まることを「開始」と言う。
 */
const NOTICE_KEYS = ['timerRecorded'] as const;
const MENU_KEYS = ['startChildCountup', 'startChildPomodoro', 'startCountupForDailyNote', 'startPomodoroForDailyNote'] as const;

const tables = (namespace: string): Record<string, Record<string, string>> => ({
    en: (en as unknown as Record<string, Record<string, string>>)[namespace],
    ja: (ja as unknown as Record<string, Record<string, string>>)[namespace],
});

describe('timer notice and menu labels', () => {
    for (const [name, table] of Object.entries(tables('notice'))) {
        it(`${name}: one recorded notice names the kind, the icon and the duration`, () => {
            for (const key of NOTICE_KEYS) {
                expect(table[key], `notice.${key} missing in ${name}`).toBeTruthy();
            }
            for (const slot of ['{{icon}}', '{{kind}}', '{{duration}}']) expect(table.timerRecorded).toContain(slot);
            for (const gone of ['countdownRecorded', 'kindRecorded', 'taskUpdated']) expect(table[gone]).toBeUndefined();
        });
    }

    for (const [name, table] of Object.entries(tables('menu'))) {
        it(`${name}: the menu starts a child or daily note timer, and does not open one`, () => {
            for (const key of MENU_KEYS) {
                expect(table[key], `menu.${key} missing in ${name}`).toBeTruthy();
            }
            for (const gone of ['openCountup', 'openPomodoro', 'openCountupForDailyNote', 'openPomodoroForDailyNote']) {
                expect(table[gone]).toBeUndefined();
            }
        });
    }
});
