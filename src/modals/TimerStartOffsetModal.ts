import type { App } from 'obsidian';
import { t } from '../i18n';
import { agoLabel, OFFSET_FIELDS, offsetStart, startLabel, type OffsetInput, type OffsetInputKind } from '../timer/TimerStartOffset';
import { hostWindow } from '../utils/HostWindow';
import type { Read } from '../utils/values/Read';
import { OverlayShell } from '../views/sharedUI/OverlayShell';
import { FormActions } from './form/FormActions';
import { onFormEnter } from './form/formEnter';
import { createFormRow } from './form/formRow';
import { IssueBoard, readIssue } from './form/FormIssue';
import { createPickerTextField, type PickerTextField } from './form/PickerTextField';

/**
 * 「ずらす量を指定…」のダイアログ。走っているタイマーの開始を、量（何分前）か
 * 時刻で指定する。欄は `TimerStartOffset.OFFSET_FIELDS` の codec で読み、読めた
 * 値からずらし先を `offsetStart` で決める。ここは描くだけ。ずらす書き込みは
 * 呼び出し側（`TimerLifecycle.offsetStart`）が持つ。
 *
 * - 上の切り替え（`tv-ctrl__segments`）で量と時刻を選ぶ。量は分の欄、時刻はハブと
 *   同じ時刻の欄（`PickerTextField`）で、OS の時刻の選択も開ける
 * - 欄の行のすぐ下に、ずらした先の見通し（「開始 14:35（50 分前）」）を出す。読めない
 *   値ではそこに理由を出し、欄を赤くし（`IssueBoard`）、決定のボタンを押せなくする。
 *   空の欄は何も言わず、押せなくするだけ
 * - 「何分前」と量の行き先は今から数えるので、開いている間は毎秒描き直す。決定は
 *   押した時点の今で読み直す
 *
 * 送るダイアログ（`SendModal`）と同じく、フォームの共通の部品（`_form.css`、
 * `FormActions`）で組み、OverlayShell の上に立つ。
 */
export class TimerStartOffsetModal {
    private readonly overlay = new OverlayShell();
    private kind: OffsetInputKind = 'minutes';
    private readonly segments = new Map<OffsetInputKind, HTMLButtonElement>();
    private readonly rows = {} as Record<OffsetInputKind, { row: HTMLElement; says: HTMLElement }>;
    private minutesInput!: HTMLInputElement;
    private timeField!: PickerTextField;
    private issues!: IssueBoard<OffsetInputKind>;
    private actions!: FormActions;
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
            initialFocus: () => this.input(),
            build: (bodyEl) => this.build(bodyEl),
            onClose: () => this.stopTick?.(),
        });
        // The window the overlay stands in (popout aware).
        const win = hostWindow(this.overlay.getPanel());
        const tick = win.setInterval(() => this.render(), 1000);
        this.stopTick = () => win.clearInterval(tick);
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
        this.rows.minutes = createFormRow(group, t('timer.offsetMinutesLabel'));
        this.minutesInput = this.rows.minutes.row.createEl('input', {
            type: 'text',
            cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow tv-form__control',
            placeholder: '20',
        });
        this.minutesInput.inputMode = 'numeric';

        this.rows.time = createFormRow(group, t('timer.offsetTimeLabel'));
        // A pick and a clear put a value in with no event of the text: they are drawn as typing is.
        this.timeField = createPickerTextField(this.rows.time.row.createDiv({ cls: 'tv-form__field' }), 'time', 'HH:MM', '', {
            onPick: () => this.render(),
            onClear: () => this.render(),
        });

        for (const input of [this.minutesInput, this.timeField.input]) {
            input.addEventListener('input', () => this.render());
            onFormEnter(input, () => this.submit());
        }

        const formSays = bodyEl.createDiv({ cls: 'tv-form__says tv-form__says--form' });
        this.issues = new IssueBoard<OffsetInputKind>({
            field: (kind) => ({ input: kind === 'minutes' ? this.minutesInput : this.timeField.input, message: this.rows[kind].says }),
            form: formSays,
        });
        this.actions = new FormActions(bodyEl, {
            cancel: { run: () => { void this.overlay.requestClose(); } },
            actions: [{ label: t('timer.offsetApply'), tone: 'cta', run: () => this.submit() }],
        });

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

    /** The field shown, read: null while it is empty, which says nothing. */
    private read(): Read<OffsetInput> | null {
        const text = this.input().value;
        if (text.trim() === '') return null;
        if (this.kind === 'minutes') {
            const read = OFFSET_FIELDS.minutes.read(text);
            return read.ok ? { ok: true, value: { kind: 'minutes', minutes: read.value } } : read;
        }
        const read = OFFSET_FIELDS.time.read(text);
        return read.ok ? { ok: true, value: { kind: 'time', time: read.value } } : read;
    }

    /** 切り替え、見えている欄、見通しか理由、決定のボタンを、今の欄と今の時刻で描く。 */
    private render(): void {
        for (const [kind, btn] of this.segments) {
            btn.toggleClass('is-active', kind === this.kind);
            btn.setAttribute('aria-pressed', String(kind === this.kind));
        }
        this.rows.minutes.row.toggle(this.kind === 'minutes');
        this.rows.time.row.toggle(this.kind === 'time');

        const read = this.read();
        const now = Date.now();
        if (read?.ok) {
            const startMs = offsetStart(read.value, now);
            this.issues.set('read', [{
                at: this.kind,
                tone: 'info',
                text: t('timer.offsetPreview', { time: startLabel(startMs, now), ago: agoLabel(startMs, now) }),
            }]);
        } else {
            this.issues.set('read', readIssue(this.kind, read ? read.issue : null));
        }
        this.actions.render({ busy: false, ctaEnabled: read?.ok ?? false });
    }

    private submit(): void {
        const read = this.read();
        if (!read?.ok) return;
        this.overlay.close();
        this.apply(offsetStart(read.value, Date.now()));
    }
}
