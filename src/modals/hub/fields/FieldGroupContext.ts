import type { App } from 'obsidian';
import type { Task } from '../../../types';
import type { PluginContext } from '../../../PluginContext';
import type { TaskReadService } from '../../../services/data/TaskReadService';
import type { PopoverStack } from '../../../views/sharedUI/PopoverStack';
import type { CascadeSourceKind } from '../CascadeSource';

/**
 * TaskHubForm の各フィールドグループ（Tags/Style/Properties）が共有する
 * ホスト依存。フィールドグループは自前の task コピーを持たず、常に
 * `getTask()` 経由で TaskHubForm 本体の最新値を読む — 楽観更新
 * （`queue` 内で `this.task` が即座に書き換わる）と echo 反映の両方が
 * このゲッター 1 つを通るので、フィールドグループ側に鮮度の管理が要らない。
 */
export interface FieldGroupContext {
    getTask: () => Task;
    isMissing: () => boolean;
    queue: (updates: Partial<Task> | null) => void;
    app: App;
    plugin: PluginContext;
    readService: TaskReadService;
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
    showFormError: (message: string) => void;
}
