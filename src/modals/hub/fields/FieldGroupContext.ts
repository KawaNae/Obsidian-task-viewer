import type { App } from 'obsidian';
import type { Task } from '../../../types';
import type { PluginContext } from '../../../PluginContext';
import type { IndexReads } from '../../../services/core/TaskIndex';
import type { DateKey } from './DateFieldGroup';
import type { IssueBoard } from '../../form/FormIssue';
import type { Written } from '../../form/bindField';
import type { FindingField, HubFinding } from '../HubFindings';
import type { LineTarget } from '../SourceLine';

/**
 * The hub's fields, by the names its issues are said of (`FormIssue.at`):
 * the name, the six date fields, the tag to add, the style's three, the key
 * of the property to add, and each property's value (`prop:<key>`).
 */
export type HubField = 'name' | DateKey | 'tags' | 'color' | 'linestyle' | 'mask' | 'propKey' | `prop:${string}`;

/** A field whose text a close cannot save, by the name the question lists it by, and the control to fix it in. */
export interface UnsavedField {
    label: string;
    input: HTMLElement;
}

/**
 * What the hub's close asks of a part of its form (`TaskHubForm.beforeClose`):
 * the fields whose text cannot be saved, throwing that text away, and saving
 * what is typed and reads, as a blur would. Throwing away what the host
 * holds (cancel) throws away all that is typed, read or not
 * (`discardTyped`): the fields show the value again.
 */
export interface ClosingPart {
    unsaved(): UnsavedField[];
    discardUnsaved(): void;
    discardTyped(): void;
    save(): void;
}

/**
 * TaskHubForm の各欄の部品（Name/Status/Tags/Style/Properties）が共有する
 * 依存。値を読む口（`task`）と値を渡す口（`put`）はフォームのホストの同じ
 * 名の口（`HubHost.task`、`HubHost.put`）につながり、いつ、どこへ書くかは
 * ホストが決める。欄の部品は自前の task コピーを持たず、常に `task()` 経由で
 * ホストの最新値を読む — 渡した値（`put` が値に即座に重ねる）と echo 反映の
 * 両方がこのゲッター 1 つを通るので、欄の部品の側に鮮度の管理が要らない。
 */
export interface FieldGroupContext {
    task: () => Task;
    isShut: () => boolean;
    /**
     * Hand `updates` on to the host from the field `at` (`'form'`: a field
     * with no place of its own to say a refusal under, the status): whether
     * they were taken, and, refused, whether the field keeps what was typed
     * (`HubHost.put`). A refusal is said by the host.
     */
    put: (updates: Partial<Task> | null, at: HubField | 'form') => Promise<Written>;
    app: App;
    plugin: PluginContext;
    index: IndexReads;
    /**
     * Open a line of the row's note in the editor and light it (`openSourceLine`):
     * the line `locate` finds on a copy of the row, which is asked again of a
     * newer copy when the note has changed. The hub closes. Null when the
     * host has no row to open (`HubHost.openSource`): a field says where an
     * inherited value comes from, drawn as nothing to press, with no
     * listener on it.
     */
    openSource: ((locate: (task: Task) => LineTarget | null) => void) | null;
    /** What the row's own property lines hold that is wrong, by field (`hubFindings`), as the form last read them. */
    findings: () => readonly HubFinding[];
    /**
     * Whether a finding locks the field: its block is one the plugin does
     * not write (the write would be refused), so the field takes no edit
     * and says why, with the line to open in the editor.
     */
    locked: (field: FindingField) => boolean;
    /**
     * Where the form's issues are said. A group says its fields' under the
     * source of the field's name, and draws them again once it has built its
     * rows anew (`IssueBoard.redraw`).
     */
    issues: IssueBoard<HubField>;
}
