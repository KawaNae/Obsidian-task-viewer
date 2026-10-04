import { DateUtils } from '../../utils/DateUtils';
import { t } from '../../i18n';
import type { Task } from '../../types';
import { DateInput, TimeInput } from '../../utils/values/DateValues';
import { optional, type FieldCodec, type Issue } from '../../utils/values/Read';
import { toDisplayTask } from '../../services/display/DisplayTaskConverter';
import { dateRuleIssues, type DateTimeFields, type ValidationContext } from '../TaskDateValidator';
import { bindField, type BoundField } from './bindField';
import { onFormEnter } from './formEnter';
import { readIssue, type FormIssue, type IssueSlot } from './FormIssue';
import { createPickerTextField, type PickerTextField } from './PickerTextField';
import { createFormRow } from './formRow';

export type DateGroupKey = 'start' | 'end' | 'due';
/** One of the six fields: a group's date or its time. */
export type DateKey = keyof DateTimeFields;

const GROUP_KEYS: Record<DateGroupKey, readonly [DateKey, DateKey]> = {
    start: ['startDate', 'startTime'],
    end: ['endDate', 'endTime'],
    due: ['dueDate', 'dueTime'],
};
const KEYS: readonly DateKey[] = ['startDate', 'startTime', 'endDate', 'endTime', 'dueDate', 'dueTime'];
const DATE_FIELD = optional(DateInput);
const TIME_FIELD = optional(TimeInput);

function groupOf(key: DateKey): DateGroupKey {
    return key.startsWith('start') ? 'start' : key.startsWith('end') ? 'end' : 'due';
}

export interface DateFieldGroupOptions {
    labels: { start: string; end: string; due: string };
    icons?: Partial<Record<DateGroupKey, string>>;
    initial: Partial<DateTimeFields>;
    buildOverlayTask: (f: DateTimeFields) => Task;
    getStartHour: () => number;
    taskLookup: (id: string) => Task | undefined;
    getValidationCtx: () => ValidationContext;
    /**
     * The values the fields stand for now (the hub's row, `''` for none);
     * absent for a task not yet written (the create dialog), whose fields
     * stand for nothing until it is.
     */
    current?: () => DateTimeFields;
    /**
     * A group's fields were committed (a blur, the form's Enter, a pick, a
     * clear), every field reading and the rules holding: `f` is the six as
     * read. Not called while one does not read or a rule is broken. Whether
     * the write took it, when a write decides (`bindField`'s commit).
     */
    onCommit?: (group: DateGroupKey, f: DateTimeFields) => void | Promise<boolean>;
    /** The form's Enter in a field, after the field's commit: the create dialog's submit. */
    onEnter?: () => void;
    /** A field's text changed, by typing, a pick or a clear. */
    onChange?: () => void;
    /** What the six fields say now, in place of what they said: each field's reading, then the rules across them. */
    issues: (issues: FormIssue<DateKey>[]) => void;
}

/**
 * 6 つの日付/時刻入力（開始/終了/期限 × 日付/時刻）をまとめて所有する
 * フォーム部品。CreateModal と TaskHubForm が共用する。
 *
 * 行文法: ラベル左置き + date:time = 2:1 flex 配分（_form.css）。
 *
 * 各欄は `bindField` で値に結ぶ。日付は `DateInput`、時刻は `TimeInput` で
 * 読み（全角と長音、1桁の時を読み、確定で `2026-10-05`、`09:40` の形に
 * 書き換える）、空の欄は「宣言なし」と読む。読めない欄は欄の下に理由を出し、
 * 確定しない。6 欄が読めたら、欄をまたぐ規則（時刻には日付が要る、終了は
 * 開始の後）を `dateRuleIssues` で見て、破れた欄に出す。
 *
 * ピッカーの選択と × は `PickerTextField` の知らせで確定する。外からの値は
 * {@link set} で入れ、イベントを投げない。
 */
export class DateFieldGroup {
    private readonly inputs = new Map<DateKey, HTMLInputElement>();
    private readonly bound = new Map<DateKey, BoundField<string | undefined>>();
    private readonly says = new Map<DateKey, HTMLElement>();
    private readonly fields: PickerTextField[] = [];
    /** What each field's text reads as wrong now. */
    private readonly readIssues = new Map<DateKey, Issue>();

    constructor(
        container: HTMLElement,
        private opts: DateFieldGroupOptions,
    ) {
        for (const group of ['start', 'end', 'due'] as const) {
            this.renderRow(container, group, opts.labels[group]);
        }
    }

    private renderRow(container: HTMLElement, group: DateGroupKey, label: string): void {
        const { row, says } = createFormRow(container, label, { dates: true, icon: this.opts.icons?.[group] });
        const [dateKey, timeKey] = GROUP_KEYS[group];

        const dateBox = row.createDiv({ cls: 'tv-form__field tv-form__field--date' });
        this.renderField(dateBox, dateKey, 'date', `${label} — ${t('modal.date')}`, says);
        const timeBox = row.createDiv({ cls: 'tv-form__field tv-form__field--time' });
        this.renderField(timeBox, timeKey, 'time', `${label} — ${t('modal.time')}`, says);
    }

    private renderField(box: HTMLElement, key: DateKey, kind: 'date' | 'time', ariaLabel: string, says: HTMLElement): void {
        const codec: FieldCodec<string | undefined> = kind === 'date' ? DATE_FIELD : TIME_FIELD;
        // The picker and the clear button put a value in: it is committed as a blur would.
        const changedBy = () => {
            this.changed();
            this.bound.get(key)?.commit();
        };
        const field = createPickerTextField(box, kind, kind === 'date' ? 'YYYY-MM-DD' : 'HH:mm', this.opts.initial[key] ?? '', {
            onPick: changedBy,
            onClear: changedBy,
        });
        field.input.setAttribute('aria-label', ariaLabel);
        this.fields.push(field);
        this.inputs.set(key, field.input);
        this.says.set(key, says);

        this.bound.set(key, bindField(field.input, {
            codec,
            current: () => this.currentOf(key),
            commit: () => this.commitGroup(groupOf(key)),
            issues: (issue) => {
                if (issue) this.readIssues.set(key, issue);
                else this.readIssues.delete(key);
                this.tell();
            },
            put: (text) => field.setText(text),
        }));
        field.input.addEventListener('input', () => this.changed());
        const onEnter = this.opts.onEnter;
        if (onEnter) onFormEnter(field.input, () => onEnter());
    }

    private currentOf(key: DateKey): string | undefined {
        return this.opts.current?.()[key] || undefined;
    }

    private changed(): void {
        this.updatePlaceholders();
        this.opts.onChange?.();
    }

    /**
     * The six as read, `''` for an empty field; null while one does not
     * read. A field that reads holds the value read, even before a commit.
     */
    private readAll(): DateTimeFields | null {
        const out = {} as DateTimeFields;
        for (const key of KEYS) {
            const input = this.inputs.get(key)!;
            const read = (key.endsWith('Date') ? DATE_FIELD : TIME_FIELD).read(input.value);
            if (!read.ok) return null;
            out[key] = read.value ?? '';
        }
        return out;
    }

    /** What the six say now: each field's reading, and, once all read, the rules across them. */
    private issuesNow(): FormIssue<DateKey>[] {
        const read = KEYS.flatMap(key => readIssue(key, this.readIssues.get(key) ?? null));
        if (read.length > 0) return read;
        const fields = this.readAll();
        return fields ? dateRuleIssues(fields, this.opts.getValidationCtx()) : [];
    }

    private tell(): void {
        this.opts.issues(this.issuesNow());
    }

    /** Commit `group` as its fields read, unless a field does not read or a rule is broken. */
    private commitGroup(group: DateGroupKey): boolean | Promise<boolean> {
        const fields = this.readAll();
        this.tell();
        if (!fields || dateRuleIssues(fields, this.opts.getValidationCtx()).length > 0) return false;
        return this.opts.onCommit?.(group, fields) ?? true;
    }

    /**
     * The fields whose text cannot be saved now, as a close finds them: the
     * fields typed in that do not read, or, all reading, the field a rule
     * across them is broken at. None while no field holds a text not saved.
     */
    unsaved(): DateKey[] {
        const pending = KEYS.filter(key => this.bound.get(key)!.pending() !== null);
        if (pending.length === 0) return [];
        const unread = pending.filter(key => !this.bound.get(key)!.pending()!.ok);
        if (unread.length > 0) return unread;
        const fields = this.readAll();
        if (!fields) return [];
        const broken = dateRuleIssues(fields, this.opts.getValidationCtx()).flatMap(issue => (issue.at === 'form' ? [] : [issue.at]));
        return [...new Set(broken)];
    }

    /**
     * Throw away what cannot be saved (`unsaved`): a field that does not
     * read shows its value again, and, while a rule is still broken, so does
     * every field typed in. What is left is saved by {@link save}.
     */
    discardUnsaved(): void {
        for (const key of KEYS) if (this.bound.get(key)!.pending()?.ok === false) this.bound.get(key)!.discard();
        if (this.unsaved().length > 0) for (const key of KEYS) this.bound.get(key)!.discard();
        this.updatePlaceholders();
        this.tell();
    }

    /** Commit every field typed in that reads, as a blur would: what a close saves. */
    save(): void {
        for (const key of KEYS) if (this.bound.get(key)!.pending()?.ok) this.bound.get(key)!.commit();
    }

    /** The name of the field `key` as a question lists it: its group and its part (開始の日付). */
    labelOf(key: DateKey): string {
        return t('modal.hub.dateField', { group: this.opts.labels[groupOf(key)], part: key.endsWith('Date') ? t('modal.date') : t('modal.time') });
    }

    /** Where the field `key` says its issues: its input and the line under its row. */
    slot(key: DateKey): IssueSlot {
        return { input: this.inputs.get(key)!, message: this.says.get(key)! };
    }

    /**
     * The six as read, every field reading and the rules holding (the create
     * dialog's submit); null otherwise, with why said under the fields.
     */
    read(): DateTimeFields | null {
        for (const key of KEYS) this.bound.get(key)!.commit();
        const fields = this.readAll();
        this.tell();
        if (!fields || dateRuleIssues(fields, this.opts.getValidationCtx()).length > 0) return null;
        return fields;
    }

    /**
     * The six as they stand: a field that reads as its value (normalized),
     * one that does not as its text. What the placeholders and the create
     * dialog's notice of an empty task read.
     */
    collect(): DateTimeFields {
        const out = {} as DateTimeFields;
        for (const key of KEYS) {
            const text = this.inputs.get(key)!.value;
            const read = (key.endsWith('Date') ? DATE_FIELD : TIME_FIELD).read(text);
            out[key] = read.ok ? read.value ?? '' : text.trim();
        }
        return out;
    }

    /** Put values from outside in the fields (the hub's row as the index has it), firing no event. */
    set(fields: DateTimeFields): void {
        for (const key of KEYS) this.bound.get(key)!.set(fields[key] || undefined);
        this.updatePlaceholders();
        this.tell();
    }

    updatePlaceholders(): void {
        const fields = this.collect();
        const overlay = this.opts.buildOverlayTask(fields);
        const dt = toDisplayTask(overlay, this.opts.getStartHour(), this.opts.taskLookup);
        const input = (key: DateKey) => this.inputs.get(key)!;

        input('startDate').placeholder = (dt.startDateImplicit && dt.effectiveStartDate) || 'YYYY-MM-DD';
        input('startTime').placeholder = (dt.startTimeImplicit && dt.effectiveStartDate && dt.effectiveStartTime) || 'HH:mm';
        input('endDate').placeholder = (dt.endDateImplicit && dt.effectiveEndDate) || 'YYYY-MM-DD';
        input('endTime').placeholder = (dt.endTimeImplicit && dt.effectiveEndDate && dt.effectiveEndTime) || 'HH:mm';

        // due の implicit は cascade 継承のみ (raw due なし && effectiveDue あり)。
        // 開始/終了と同じく placeholder として注入する。
        const dueInherited: { date?: string; time?: string } = !dt.due && dt.effectiveDue ? DateUtils.splitDateTime(dt.effectiveDue) : {};
        input('dueDate').placeholder = dueInherited.date || 'YYYY-MM-DD';
        input('dueTime').placeholder = dueInherited.time || 'HH:mm';
    }

    /**
     * What the fields imply, or what their rules allow, changed from outside
     * (the create dialog's place answered): the placeholders and what the
     * fields say are drawn again.
     */
    refresh(): void {
        this.updatePlaceholders();
        this.tell();
    }

    getInput(key: DateKey): HTMLInputElement {
        return this.inputs.get(key)!;
    }

    /** Every field of the group taking input or not, its picker and clear buttons with it. */
    setEnabled(enabled: boolean): void {
        for (const field of this.fields) field.setEnabled(enabled);
    }
}
