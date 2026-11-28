import { DateUtils } from '../../../utils/DateUtils';
import { sideValues } from '../../../utils/TaskDates';
import { t } from '../../../i18n';
import type { Task } from '../../../types';
import { DateInput, TimeInput } from '../../../utils/values/DateValues';
import { optional, type FieldCodec, type Issue } from '../../../utils/values/Read';
import { toDisplayTask } from '../../../services/display/DisplayTaskConverter';
import { dateRuleIssues, type DateTimeFields } from '../../TaskDateValidator';
import { bindField, type BoundField, type Written } from '../../form/bindField';
import { readIssue, type FormIssue, type IssueSlot } from '../../form/FormIssue';
import { createPickerTextField, type PickerTextField } from '../../form/PickerTextField';
import { FieldMenuButton, type FieldMenu } from '../../form/FieldMenuButton';
import { createFormRow } from '../../form/formRow';
import { TaskUpdateBuilder } from '../../form/TaskUpdateBuilder';
import { CascadeSource } from '../CascadeSource';
import type { FieldGroupContext } from './FieldGroupContext';
import { FieldLookView } from './FieldLookView';
import { FieldMenus } from './FieldMenus';
import { FieldKinds, FieldStates, type FieldAction, type FieldKind, type FieldState } from './FieldState';

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
}

/** The field `key`'s kind in the field table: the due's two fields stand for one value, `due`. */
const KINDS: Record<DateKey, FieldKind> = {
    startDate: FieldKinds.date, startTime: FieldKinds.date,
    endDate: FieldKinds.date, endTime: FieldKinds.date,
    dueDate: FieldKinds.dueDate, dueTime: FieldKinds.dueTime,
};

/** The value the field `key` shows of what its state holds: a due's date or its time, the others as they are. */
function spellOf(key: DateKey): (value: string) => string {
    if (key === 'dueDate') return value => DateUtils.splitDateTime(value).date;
    if (key === 'dueTime') return value => DateUtils.splitDateTime(value).time ?? '';
    return value => value;
}

/**
 * The whole value the field `key` stands for, as its fields show it: the
 * due's date and time together, as both its fields stand for the one due;
 * the others as {@link spellOf}.
 */
function wholeSpellOf(key: DateKey): (value: string) => string {
    if (key !== 'dueDate' && key !== 'dueTime') return spellOf(key);
    const date = spellOf('dueDate');
    const time = spellOf('dueTime');
    return value => [date(value), time(value)].filter(text => text !== '').join(' ');
}

/** A row's dates as the six fields hold them, `''` for none; the due's date and time apart. */
export function dateFieldsOf(task: Task): DateTimeFields {
    const due = DateUtils.splitDateTime(task.due ?? '');
    return {
        startDate: task.startDate || '',
        startTime: task.startTime || '',
        endDate: task.endDate || '',
        endTime: task.endTime || '',
        dueDate: due.date || '',
        dueTime: due.time || '',
    };
}

/**
 * 6 つの日付/時刻入力（開始/終了/期限 × 日付/時刻）をまとめて所有する
 * フォーム部品。TaskHubForm の日付の欄で、ほかの欄の部品と同じく
 * `FieldGroupContext` から値を読み、値を渡す。
 *
 * 行文法: ラベル左置き + date:time = 2:1 flex 配分（_form.css）。
 *
 * 各欄は `bindField` で値に結ぶ。日付は `DateInput`、時刻は `TimeInput` で
 * 読み（全角と長音、1桁の時を読み、確定で `2026-10-05`、`09:40` の形に
 * 書き換える）、空の欄は「宣言なし」と読む。読めない欄は欄の下に理由を出し、
 * 確定しない。6 欄が読めたら、欄をまたぐ規則（時刻には日付が要る、終了は
 * 開始の後）を `dateRuleIssues` で見て、破れた欄に出す。
 *
 * 欄の見た目（破線の枠と薄い字）と … のメニューの項目は、欄ごとの状態の表
 * （`FieldStates.ofDate`）が決める。開始と終了の日付と時刻は、それぞれが 1 つの
 * 値である。期限の 2 つの欄は `due` 1 つの状態を共有し、項目は期限の全体に
 * 効く（時刻の欄の「値を消す」だけは時刻だけを消す）。継承した値が無い欄の
 * 薄い字は、規則で補った値か書式である。メニューの項目は、欄の字を差し替えて、
 * 打った値と同じ確定を通す：規則に反すれば書かず、字を残して理由を欄の下に出す。
 *
 * ピッカーの選択は `PickerTextField` の知らせで確定する。欄の中に × は無い。
 * 外からの値は {@link refresh} で入れ、イベントを投げない。
 */
export class DateFieldGroup {
    private readonly inputs = new Map<DateKey, HTMLInputElement>();
    private readonly bound = new Map<DateKey, BoundField<string | undefined>>();
    private readonly says = new Map<DateKey, HTMLElement>();
    private readonly fields: PickerTextField[] = [];
    private readonly looks = new Map<DateKey, FieldLookView>();
    private readonly menus = new Map<DateKey, FieldMenuButton>();
    /** What each field's text reads as wrong now. */
    private readonly readIssues = new Map<DateKey, Issue>();

    constructor(
        container: HTMLElement,
        private readonly ctx: FieldGroupContext,
        private readonly opts: DateFieldGroupOptions,
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
        const field = createPickerTextField(box, kind, kind === 'date' ? 'YYYY-MM-DD' : 'HH:mm', this.current()[key], {
            // A value picked is committed as a blur would.
            onPick: () => {
                this.restyle();
                this.bound.get(key)?.commit();
            },
            clearable: false,
        });
        field.input.setAttribute('aria-label', ariaLabel);
        this.fields.push(field);
        this.inputs.set(key, field.input);
        this.says.set(key, says);
        this.looks.set(key, new FieldLookView(field.el, field.input));
        this.menus.set(key, new FieldMenuButton(field.el, {
            label: t('modal.hub.fieldMenu', { field: this.labelOf(key) }),
            key: `${key}:menu`,
            // The due's two fields are one value: its items put both.
            fields: () => (groupOf(key) === 'due' ? GROUP_KEYS.due : [key]).flatMap(at => this.inputs.get(at) ?? []),
            menu: () => this.menuOf(key),
            presenter: this.ctx.plugin.menuPresenter,
            disabled: () => this.ctx.isShut(),
        }));

        this.bound.set(key, bindField(field.input, {
            codec,
            current: () => this.current()[key] || undefined,
            commit: () => this.commitGroup(groupOf(key)),
            issues: (issue) => {
                if (issue) this.readIssues.set(key, issue);
                else this.readIssues.delete(key);
                this.tell();
            },
            put: (text) => field.setText(text),
        }));
        field.input.addEventListener('input', () => this.restyle());
    }

    /** The values the fields stand for now: the task's. */
    private current(): DateTimeFields {
        return dateFieldsOf(this.ctx.task());
    }

    /** The field `key` as the task is now: what the row says, and what the layers above give. */
    private stateOf(key: DateKey): FieldState<string> {
        return FieldStates.ofDate(this.ctx.task(), key);
    }

    /** The field's menu as the task is now (`FieldStates.menu`). */
    private menuOf(key: DateKey): FieldMenu {
        const { head, items } = FieldStates.menu(this.stateOf(key), KINDS[key], { opensSource: this.ctx.openSource !== null, spell: wholeSpellOf(key) });
        return {
            heads: FieldMenus.heads(head),
            items: items.map(action => FieldMenus.item(action, () => this.runMenu(key, action))),
        };
    }

    /**
     * Do what the menu item `action` of the field `key` does. What it writes
     * is put in the fields and committed as what is typed is: a rule it
     * breaks keeps it from being written, the text left in the fields and
     * why said under them, as for a value typed.
     */
    private runMenu(key: DateKey, action: FieldAction): void {
        if (this.ctx.isShut()) return;
        const group = groupOf(key);
        const field = key === 'dueDate' || key === 'dueTime' ? 'due' : key;
        switch (action.action) {
            case 'openSource':
                this.ctx.openSource?.(row => CascadeSource.lineOfField(row, field, this.ctx.plugin.settings.scopeKeys[group]));
                return;
            case 'dropOwn':
                this.putAndCommit(group === 'due' && action.reach === 'value' ? { dueDate: '', dueTime: '' } : { [key]: '' });
                return;
            case 'writeInherited': {
                const { inherited } = this.stateOf(key);
                if (inherited.kind !== 'value') return;
                if (group !== 'due') this.putAndCommit({ [key]: inherited.value });
                else {
                    const { date, time } = DateUtils.splitDateTime(inherited.value);
                    this.putAndCommit({ dueDate: date, dueTime: time ?? '' });
                }
                return;
            }
            case 'noValue':
                // A date has no way of saying no value: the table offers none.
                return;
        }
    }

    /** Put `texts` in their fields and commit them, as a blur of each would: the first refused, the rest are not tried. */
    private putAndCommit(texts: Partial<DateTimeFields>): void {
        const keys = KEYS.filter(key => texts[key] !== undefined);
        for (const key of keys) this.fields[KEYS.indexOf(key)].setText(texts[key]!);
        this.restyle();
        for (const key of keys) if (!this.bound.get(key)!.commit()) break;
        this.restyle();
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
        return fields ? this.ruleIssues(fields) : [];
    }

    /** The rules across the six as read, under what is inherited now. */
    private ruleIssues(fields: DateTimeFields): FormIssue<DateKey>[] {
        const implicitStartDate = this.ctx.task().cascadeContext?.startDate;
        return dateRuleIssues(fields, { hasImplicitStartDate: !!implicitStartDate, implicitStartDate });
    }

    /** The fields a rule across them is broken at, as `issues` finds them. */
    private brokenAt(fields: DateTimeFields): DateKey[] {
        return [...new Set(this.ruleIssues(fields).flatMap(issue => (issue.at === 'form' ? [] : [issue.at])))];
    }

    private tell(): void {
        this.ctx.issues.set('dates', this.issuesNow());
    }

    /** Commit `group` as its fields read, unless a field does not read or a rule is broken. */
    private commitGroup(group: DateGroupKey): boolean | Promise<Written> {
        const fields = this.readAll();
        this.tell();
        if (!fields || this.ruleIssues(fields).length > 0) return false;
        if (this.ctx.isShut()) return true;
        const task = this.ctx.task();
        const updates =
            group === 'start' ? TaskUpdateBuilder.dateGroup(task, 'start', fields.startDate, fields.startTime)
            : group === 'end' ? TaskUpdateBuilder.dateGroup(task, 'end', fields.endDate, fields.endTime)
            : TaskUpdateBuilder.due(task, fields.dueDate, fields.dueTime);
        return this.ctx.put(updates, `${group}Date`);
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
        return fields ? this.brokenAt(fields) : [];
    }

    /**
     * The fields a rule across the six is broken at, as they hold their text
     * now, typed or not, and under what is inherited now: what a create
     * cannot write. A field committed keeps a rule only as it was inherited
     * then, and what is inherited changes with the place (a start date the
     * heading gave, gone), so a value saved may break one since. None while
     * a field does not read, which says why under it.
     */
    ruleBroken(): DateKey[] {
        const fields = this.readAll();
        return fields ? this.brokenAt(fields) : [];
    }

    /**
     * Throw away what cannot be saved (`unsaved`): a field that does not
     * read shows its value again, and, while a rule is still broken, so does
     * every field typed in. What is left is saved by {@link save}.
     */
    discardUnsaved(): void {
        for (const key of KEYS) if (this.bound.get(key)!.pending()?.ok === false) this.bound.get(key)!.discard();
        if (this.unsaved().length > 0) for (const key of KEYS) this.bound.get(key)!.discard();
        this.restyle();
        this.tell();
    }

    /** Throw away all that is typed, read or not: every field shows its value again. */
    discardTyped(): void {
        for (const key of KEYS) this.bound.get(key)!.discard();
        this.restyle();
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
     * The six as they stand: a field that reads as its value (normalized),
     * one that does not as its text: what the fields' faint text is read of.
     */
    private collect(): DateTimeFields {
        const out = {} as DateTimeFields;
        for (const key of KEYS) {
            const text = this.inputs.get(key)!.value;
            const read = (key.endsWith('Date') ? DATE_FIELD : TIME_FIELD).read(text);
            out[key] = read.ok ? read.value ?? '' : text.trim();
        }
        return out;
    }

    /**
     * Each field's look (`FieldStates.look`) and its …, from the task as it
     * is now and the fields' text as it stands. Where the look leaves the
     * faint text to the kind, a start's or an end's field shows what the
     * rules make of the others (`sideValues`, at the precision it is written
     * with: a bare date has no time), else its format. A layer above that
     * says no value of a date shows that value, framed solid, where the
     * rules make one, and no value, framed dashed, where they do not.
     */
    private restyle(): void {
        const dt = toDisplayTask(this.overlay(this.collect()), this.ctx.plugin.settings.startHour, (id) => this.ctx.index.getTask(id));
        const sides = sideValues(dt, this.ctx.plugin.settings.startHour);
        const filled: Partial<Record<DateKey, string | undefined>> = {
            startDate: sides && !sides.start.dateWritten ? sides.start.date : undefined,
            startTime: sides && !sides.start.timeWritten ? sides.start.time : undefined,
            endDate: sides && !sides.end.dateWritten ? sides.end.date : undefined,
            endTime: sides && !sides.end.timeWritten ? sides.end.time : undefined,
        };
        for (const key of KEYS) {
            const fill = filled[key];
            const look = FieldStates.look(this.stateOf(key), KINDS[key], spellOf(key), !!fill);
            this.looks.get(key)!.show(look, fill || (key.endsWith('Date') ? 'YYYY-MM-DD' : 'HH:mm'));
            this.menus.get(key)!.sync();
        }
    }

    /** The task as the six stand: what the rules fill in is read of it. */
    private overlay(f: DateTimeFields): Task {
        return {
            ...this.ctx.task(),
            startDate: f.startDate || undefined,
            startTime: f.startTime || undefined,
            endDate: f.endDate || undefined,
            endTime: f.endTime || undefined,
            due: DateUtils.joinDateTime(f.dueDate, f.dueTime),
        };
    }

    /**
     * Put the task's values in the fields (the hub's row as it opens, as the
     * index has it after a write, an edit made elsewhere), firing no event;
     * a field typed in keeps what is typed (`BoundField.set`). Its looks and
     * what the fields say are drawn again: a rule the row breaks is said
     * from the start, as the editor's menu says it. The constructor draws
     * none of it: the form's slots for the fields are not there yet.
     */
    refresh(): void {
        const values = this.current();
        for (const key of KEYS) this.bound.get(key)!.set(values[key] || undefined);
        this.restyle();
        this.tell();
    }

    getInput(key: DateKey): HTMLInputElement {
        return this.inputs.get(key)!;
    }

    /** Every field of the group taking input or not, its picker and its … with it. */
    setEnabled(enabled: boolean): void {
        for (const field of this.fields) field.setEnabled(enabled);
        for (const menu of this.menus.values()) menu.sync();
    }
}
