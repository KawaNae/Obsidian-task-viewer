/**
 * タイマーの長さを選ぶメニュー。ウィジェットと独立ビューが同じ部品を使う。
 *
 * 選択肢の並びも「Custom…」の入り方も両者で同じで、違うのは選んだ値の行き先
 * だけ（ウィジェットは走行中タイマーの区間長も書き換え、ビューは設定を保存して
 * タイマーを作り直す）。行き先を {@link DurationField} で注入して、メニューの
 * 組み立てを 1 箇所に置く。
 */

import type { App, Menu } from 'obsidian';
import { askText } from '../modals/ask/askText';
import { t } from '../i18n';
import { SETTINGS_SCHEMA, type IntSetting } from '../settings/SettingsSchema';

/** 分数を 1 つ選ばせる項目。プリセットと Custom… を並べる。 */
export interface DurationField {
    /** 見出しと入力ダイアログに出す名前。 */
    title: string;
    presets: readonly number[];
    /**
     * Custom… が受け付ける分の範囲と読み方。設定の表（`SETTINGS_SCHEMA`）の
     * その長さのキーで、設定画面の欄と同じ範囲を読む（論点6）。
     */
    setting: IntSetting;
    get(): number;
    set(minutes: number): Promise<void>;
}

/** 作業 / 休憩の長さの行き先。自動繰り返しは走行中タイマーを持つ側だけが出す。 */
export interface PomodoroSettingsTarget {
    getWorkMinutes(): number;
    setWorkMinutes(minutes: number): Promise<void>;
    getBreakMinutes(): number;
    setBreakMinutes(minutes: number): Promise<void>;
    autoRepeat?: {
        isOn(): boolean;
        toggle(): void;
    };
}

const WORK_PRESETS = [15, 25, 30, 45, 50] as const;
const BREAK_PRESETS = [5, 10, 15] as const;
const COUNTDOWN_PRESETS = [5, 10, 15, 25, 30, 45, 50, 60] as const;
const CHECK = ' ✓';

export class TimerSettingsMenu {
    /** 作業と休憩の長さ（と、あれば自動繰り返し）を既存のメニューに足す。 */
    static addPomodoroFields(menu: Menu, app: App, target: PomodoroSettingsTarget): void {
        this.addDurationField(menu, app, {
            title: t('timer.workDuration'),
            presets: WORK_PRESETS,
            setting: SETTINGS_SCHEMA.pomodoroWorkMinutes,
            get: () => target.getWorkMinutes(),
            set: (minutes) => target.setWorkMinutes(minutes),
        });

        menu.addSeparator();

        this.addDurationField(menu, app, {
            title: t('timer.breakDuration'),
            presets: BREAK_PRESETS,
            setting: SETTINGS_SCHEMA.pomodoroBreakMinutes,
            get: () => target.getBreakMinutes(),
            set: (minutes) => target.setBreakMinutes(minutes),
        });

        const autoRepeat = target.autoRepeat;
        if (!autoRepeat) return;

        menu.addSeparator();
        menu.addItem((item) => {
            item.setTitle(`${t('timer.autoRepeat')}${autoRepeat.isOn() ? CHECK : ''}`)
                .onClick(() => autoRepeat.toggle());
        });
    }

    /** カウントダウンの長さを既存のメニューに足す。 */
    static addCountdownField(
        menu: Menu,
        app: App,
        target: { get(): number; set(minutes: number): Promise<void> },
    ): void {
        this.addDurationField(menu, app, {
            title: t('timer.countdownDuration'),
            presets: COUNTDOWN_PRESETS,
            setting: SETTINGS_SCHEMA.countdownMinutes,
            get: () => target.get(),
            set: (minutes) => target.set(minutes),
        });
    }

    private static addDurationField(menu: Menu, app: App, field: DurationField): void {
        menu.addItem((item) => {
            item.setTitle(field.title).setDisabled(true);
        });

        for (const minutes of field.presets) {
            menu.addItem((item) => {
                const current = field.get();
                item.setTitle(`  ${minutes} ${t('timer.minSuffix')}${current === minutes ? CHECK : ''}`)
                    .onClick(() => void field.set(minutes));
            });
        }

        menu.addItem((item) => {
            const current = field.get();
            const isCustom = !field.presets.includes(current);
            const suffix = isCustom ? ` (${current} ${t('timer.minSuffix')})${CHECK}` : '';
            item.setTitle(`  ${t('timer.custom')}${suffix}`)
                .onClick(() => {
                    // What does not read as a whole number in range is said
                    // under the field, and the dialog stays.
                    void askText(app, {
                        title: field.title,
                        label: minutesLabel(field.setting),
                        initial: current.toString(),
                        codec: field.setting.codec,
                        numeric: true,
                        submitLabel: t('modal.ok'),
                        submit: async (minutes) => {
                            await field.set(minutes);
                            return null;
                        },
                    });
                });
        });
    }
}

/** The Custom… field's label: the minutes, and the range they are read in. */
function minutesLabel(setting: IntSetting): string {
    const { min = 1, max } = setting.range;
    return max === undefined ? t('timer.minutesAtLeast', { min }) : t('timer.minutesRange', { min, max });
}
