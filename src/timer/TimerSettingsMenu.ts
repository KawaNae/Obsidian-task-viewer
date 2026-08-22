/**
 * タイマーの長さを選ぶメニュー。ウィジェットと独立ビューが同じ部品を使う。
 *
 * 選択肢の並びも「Custom…」の入り方も両者で同じで、違うのは選んだ値の行き先
 * だけ（ウィジェットは走行中タイマーの区間長も書き換え、ビューは設定を保存して
 * タイマーを作り直す）。行き先を {@link DurationField} で注入して、メニューの
 * 組み立てを 1 箇所に置く。
 */

import type { App, Menu } from 'obsidian';
import { InputModal } from '../modals/InputModal';
import { t } from '../i18n';

/** 分数を 1 つ選ばせる項目。プリセットと Custom… を並べる。 */
export interface DurationField {
    /** 見出しと入力ダイアログに出す名前。 */
    title: string;
    presets: readonly number[];
    /** Custom… で受け付ける上限（分）。 */
    maxMinutes: number;
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
            maxMinutes: 120,
            get: () => target.getWorkMinutes(),
            set: (minutes) => target.setWorkMinutes(minutes),
        });

        menu.addSeparator();

        this.addDurationField(menu, app, {
            title: t('timer.breakDuration'),
            presets: BREAK_PRESETS,
            maxMinutes: 60,
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
            maxMinutes: 120,
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
                    new InputModal(
                        app,
                        field.title,
                        t('timer.minutesRange', { min: 1, max: field.maxMinutes }),
                        current.toString(),
                        async (value) => {
                            const minutes = parseInt(value, 10);
                            if (isNaN(minutes) || minutes <= 0 || minutes > field.maxMinutes) return;
                            await field.set(minutes);
                        },
                    ).open();
                });
        });
    }
}
