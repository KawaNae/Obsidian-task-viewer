import type { App } from 'obsidian';
import type { Task } from '../../../types';
import type { PluginContext } from '../../../PluginContext';
import type { IndexReads } from '../../../services/core/TaskIndex';
import type { PopoverStack } from '../../../views/sharedUI/PopoverStack';
import type { CascadeSourceKind } from '../CascadeSource';
import type { DateKey } from '../../form/DateFieldGroup';
import type { IssueBoard } from '../../form/FormIssue';

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
 * what is typed and reads, as a blur would.
 */
export interface ClosingPart {
    unsaved(): UnsavedField[];
    discardUnsaved(): void;
    save(): void;
}

/**
 * TaskHubForm の各フィールドグループ（Tags/Style/Properties）が共有する
 * ホスト依存。フィールドグループは自前の task コピーを持たず、常に
 * `getTask()` 経由で TaskHubForm 本体の最新値を読む — 楽観更新
 * （`queue` 内で `this.task` が即座に書き換わる）と echo 反映の両方が
 * このゲッター 1 つを通るので、フィールドグループ側に鮮度の管理が要らない。
 */
export interface FieldGroupContext {
    getTask: () => Task;
    isShut: () => boolean;
    /** Write `updates`: whether the write took them (a refusal is said by the form). */
    queue: (updates: Partial<Task> | null) => Promise<boolean>;
    app: App;
    plugin: PluginContext;
    index: IndexReads;
    stack: PopoverStack;
    attachSuggest: (
        input: HTMLInputElement,
        anchorEl: HTMLElement,
        opts: {
            getCandidates: (query: string) => string[];
            renderItem?: (itemEl: HTMLElement, value: string) => void;
            onPick: (value: string) => void;
        },
    ) => void;
    sourceLabel: (source: CascadeSourceKind) => string;
    jumpToFile: () => void;
    /**
     * Where the form's issues are said. A group says its fields' under the
     * source of the field's name, and draws them again once it has built its
     * rows anew (`IssueBoard.redraw`).
     */
    issues: IssueBoard<HubField>;
}
