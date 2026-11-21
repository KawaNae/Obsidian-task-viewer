/**
 * The name in a timer item's header: the name of the row the timer runs on
 * (its tail), drawn as a card draws a name, and a button that opens that
 * row's hub with the name field focused. The widget writes no name; the name
 * is changed in the hub, and comes back through the index.
 *
 * The name is a button only while the index has the row. Before the start
 * write lands, before the first scan after a restore, and after the row is
 * deleted it is plain text: the timer's copy of its subject's name, faint, as
 * the empty name is.
 *
 * A link in the name is not followed: the whole name is one button.
 */

import { type App, Component } from 'obsidian';
import type { Task } from '../types';
import type { TaskHubPanelOptions } from '../modals/hub/TaskHubPanel';
import type { TimerState } from './TimerState';
import { renderCardMarkdown } from '../views/taskcard/CardMarkdown';
import { withoutEmbeds } from '../services/parsing/utils/InlineNotation';
import { splitTimerIcon } from '../utils/TimerIcons';
import { t } from '../i18n';

export interface TitleDeps {
    app: App;
    /** The timer's tail row as the index last read it (`TimerRecorder.tailInIndex`). */
    tailRow(timer: TimerState): Task | undefined;
    openTaskHub(taskId: string, options?: TaskHubPanelOptions): void;
}

const NAME = 'timer-widget__title-name';
/** The name of a timer, which wraps; the idle header's name stays on one line. */
const ROW = `${NAME}--row`;
const OPENABLE = `${NAME}--openable`;
/** No name to draw: the timer's copy of its subject's name, faint. */
const PLACEHOLDER = `${NAME}--placeholder`;

/** What a name was drawn from; the same source is not drawn again. */
interface TitleSource {
    openable: boolean;
    /** The markdown to draw, or null when the placeholder is shown. */
    markdown: string | null;
    text: string;
    file: string;
}

export class TimerTitle {
    /** The component each timer's drawn name lives in, by timer id. */
    private components = new Map<string, Component>();

    constructor(private deps: TitleDeps) {}

    /** Put the name into `titleEl`, the header's title, and bind its presses. */
    mount(titleEl: HTMLElement, timer: TimerState): void {
        const nameEl = titleEl.createDiv(`${NAME} ${ROW}`);
        // A link in the name would open its note or page by its own default;
        // the press is the name's, whatever it lands on.
        nameEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.open(timer);
        });
        nameEl.addEventListener('auxclick', (e) => e.preventDefault());
        nameEl.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            e.stopPropagation();
            this.open(timer);
        });
        this.sync(titleEl, timer);
    }

    /**
     * Draw the name again from the index's read, and make it a button or
     * plain text. Called for every change of the index, so a name drawn from
     * the same source is left as it is.
     */
    sync(titleEl: HTMLElement, timer: TimerState): void {
        const nameEl = titleEl.querySelector(`.${ROW}`) as HTMLElement | null;
        if (!nameEl) return;
        const source = this.sourceOf(timer);
        const key = JSON.stringify(source);
        if (nameEl.dataset.titleSource === key) return;
        nameEl.dataset.titleSource = key;

        nameEl.toggleClass(OPENABLE, source.openable);
        if (source.openable) {
            nameEl.setAttribute('role', 'button');
            nameEl.setAttribute('tabindex', '0');
            nameEl.setAttribute('aria-label', t('timer.openTask'));
        } else {
            nameEl.removeAttribute('role');
            nameEl.removeAttribute('tabindex');
            nameEl.removeAttribute('aria-label');
        }
        nameEl.toggleClass(PLACEHOLDER, source.markdown === null);

        this.release(timer.id);
        nameEl.empty();
        if (source.markdown === null) {
            nameEl.setText(source.text);
            return;
        }
        const component = new Component();
        component.load();
        this.components.set(timer.id, component);
        void renderCardMarkdown(this.deps.app, source.markdown, nameEl, source.file, component);
        // Tab stops at the name, not at a link inside it.
        nameEl.querySelectorAll('a').forEach((a) => a.setAttribute('tabindex', '-1'));
    }

    /** Unload every drawn name: before the items are built again, and when the widget goes. */
    clear(): void {
        for (const component of this.components.values()) component.unload();
        this.components.clear();
    }

    /** Open the hub on the tail row as the index has it at the press; nothing when it has none. */
    private open(timer: TimerState): void {
        const row = this.deps.tailRow(timer);
        if (!row) return;
        this.deps.openTaskHub(row.id, { focusField: 'name' });
    }

    /**
     * The tail row's name without its timer icon and embeds, as a card's
     * compact name drops embeds. A row with no name, and no row, show the
     * timer's copy of its subject's name (a daily note's is its date): what
     * is being timed stays in sight.
     */
    private sourceOf(timer: TimerState): TitleSource {
        const row = this.deps.tailRow(timer);
        const name = row ? withoutEmbeds(splitTimerIcon(row.content).name).trim() : '';
        const placeholder = timer.name || '—';
        return {
            openable: row !== undefined,
            markdown: name === '' ? null : name,
            text: name === '' ? placeholder : name,
            file: timer.file,
        };
    }

    private release(timerId: string): void {
        this.components.get(timerId)?.unload();
        this.components.delete(timerId);
    }
}
