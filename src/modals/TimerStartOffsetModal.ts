import type { App } from 'obsidian';
import { t } from '../i18n';
import { agoLabel, readOffsetInput, startLabel, type OffsetInputKind } from '../timer/TimerStartOffset';
import { hostWindow } from '../utils/HostWindow';
import { OverlayShell } from '../views/sharedUI/OverlayShell';
import { createFormRow } from './form/formRow';
import { createPickerTextField, type PickerTextField } from './form/PickerTextField';

/**
 * 「ずらす量を指定…」のダイアログ。走っているタイマーの開始を、量（何分前）か
 * 時刻で指定する。値の読み方は `TimerStartOffset.readOffsetInput` が持ち、ここは
 * 描くだけ。ずらす書き込みは呼び出し側（`TimerLifecycle.offsetStart`）が持つ。
 *
 * - 上の切り替え（`tv-ctrl__segments`）で量と時刻を選ぶ。量は分の欄、時刻はハブと
 *   同じ時刻の欄（`PickerTextField`）で、OS の時刻の選択も開ける
 * - 欄のすぐ下に、ずらした先の見通し（「開始 14:35（50 分前）」）を出す。読めない
 *   値ではそこに警告を出し、欄を赤くし、決定のボタンを押せなくする。空の欄は何も
 *   言わず、押せなくするだけ
 * - 「何分前」と量の行き先は今から数えるので、開いている間は毎秒描き直す。決定は
 *   押した時点の今で読み直す
 *
 * 送るダイアログ（`SendModal`）と同じく、フォームの共通の部品（`_form.css`）で
 * 組み、OverlayShell の上に立つ。
 */
export class TimerStartOffsetModal {
    private readonly overlay = new OverlayShell();
    private kind: OffsetInputKind = 'minutes';
    private readonly segments = new Map<OffsetInputKind, HTMLButtonElement>();
    private minutesRow!: HTMLElement;
    private minutesInput!: HTMLInputElement;
    private timeRow!: HTMLElement;
    private timeField!: PickerTextField;
    private saysEl!: HTMLElement;
    private applyBtn!: HTMLButtonElement;
    private stopTick: (() => void) | null = null;

    /** @param apply ずらし先の時刻（ミリ秒）。決定で呼び、ダイアログは閉じる。 */
    constructor(
        private readonly app: App,
        private readonly apply: (startMs: number) => void,
    ) { }

    open(): void {
        if (this.overlay.isOpen()) return;
        this.overlay.open({
            mode: 'centered',
            panelClass: 'tv-overlay__panel--dialog tv-timer-offset',
            keymap: this.app.keymap,
            build: (bodyEl) => this.build(bodyEl),
            onClose: () => this.stopTick?.(),
        });
        // The window the overlay stands in (popout aware), as the other dialogs focus.
        const win = hostWindow(this.overlay.getPanel());
        const tick = win.setInterval(() => this.render(), 1000);
        this.stopTick = () => win.clearInterval(tick);
        win.requestAnimationFrame(() => this.input().focus());
    }

    private build(bodyEl: HTMLElement): void {
        bodyEl.addClass('tv-form');
        bodyEl.createEl('h2', { text: t('timer.offsetStart'), cls: 'tv-form__title' });

        const segments = bodyEl.createDiv({ cls: 'tv-ctrl__segments' });
        for (const [kind, label] of [['minutes', t('timer.offsetByMinutes')], ['time', t('timer.offsetByTime')]] as const) {
            const btn = segments.createEl('button', { text: label, attr: { type: 'button' } });
            btn.addEventListener('click', () => this.choose(kind));
            this.segments.set(kind, btn);
        }

        const group = bodyEl.createDiv({ cls: 'tv-form__group' });
        ({ row: this.minutesRow } = createFormRow(group, t('timer.offsetMinutesLabel')));
        this.minutesInput = this.minutesRow.createEl('input', {
            type: 'text',
            cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow tv-form__control',
            placeholder: '20',
        });
        this.minutesInput.inputMode = 'numeric';

        ({ row: this.timeRow } = createFormRow(group, t('timer.offsetTimeLabel')));
        this.timeField = createPickerTextField(this.timeRow.createDiv({ cls: 'tv-form__field' }), 'time', 'HH:MM', '');

        for (const input of [this.minutesInput, this.timeField.input]) {
            input.addEventListener('input', () => this.render());
            input.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key !== 'Enter' || e.isComposing) return;
                e.preventDefault();
                this.submit();
            });
        }
        this.saysEl = group.createDiv({ cls: 'tv-timer-offset__says' });

        const actions = bodyEl.createDiv({ cls: 'tv-form__buttons' });
        const cancelBtn = actions.createEl('button', { text: t('modal.cancel'), attr: { type: 'button' } });
        cancelBtn.addEventListener('click', () => this.overlay.requestClose());
        this.applyBtn = actions.createEl('button', { cls: 'mod-cta', text: t('timer.offsetApply'), attr: { type: 'button' } });
        this.applyBtn.addEventListener('click', () => this.submit());

        this.render();
    }

    private choose(kind: OffsetInputKind): void {
        if (this.kind === kind) return;
        this.kind = kind;
        this.render();
        this.input().focus();
    }

    private input(): HTMLInputElement {
        return this.kind === 'minutes' ? this.minutesInput : this.timeField.input;
    }

    /** 切り替え、見えている欄、見通しか警告、決定のボタンを、今の欄と今の時刻で描く。 */
    private render(): void {
        for (const [kind, btn] of this.segments) {
            btn.toggleClass('is-active', kind === this.kind);
            btn.setAttribute('aria-pressed', String(kind === this.kind));
        }
        this.minutesRow.toggle(this.kind === 'minutes');
        this.timeRow.toggle(this.kind === 'time');

        const input = this.input();
        const now = Date.now();
        const empty = input.value.trim() === '';
        const startMs = empty ? null : readOffsetInput(this.kind, input.value, now);
        const unreadable = !empty && startMs === null;

        input.toggleClass('tv-ctrl__text-input--invalid', unreadable);
        this.saysEl.removeClass('tv-form__info', 'tv-form__warning');
        if (startMs !== null) {
            this.saysEl.setText(t('timer.offsetPreview', { time: startLabel(startMs, now), ago: agoLabel(startMs, now) }));
            this.saysEl.addClass('tv-form__info');
        } else if (unreadable) {
            this.saysEl.setText(this.kind === 'minutes' ? t('timer.offsetMinutesUnreadable') : t('timer.offsetTimeUnreadable'));
            this.saysEl.addClass('tv-form__warning');
        }
        this.saysEl.toggle(!empty);
        this.applyBtn.disabled = startMs === null;
    }

    private submit(): void {
        const startMs = readOffsetInput(this.kind, this.input().value, Date.now());
        if (startMs === null) return;
        this.overlay.close();
        this.apply(startMs);
    }
}
