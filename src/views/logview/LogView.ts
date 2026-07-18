import { ItemView, Notice, type WorkspaceLeaf, setIcon } from "obsidian";
import {
    type LogLevel,
    type LogEntry,
    getLogEntries,
    clearLog,
    onLogEntry,
} from "../../log/log";
import { t } from "../../i18n";

export const VIEW_TYPE_LOG = "task-viewer-log-view";

const LEVEL_LABELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

function formatTimestamp(ts: number): string {
    return new Date(ts).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

export class LogView extends ItemView {
    private filter: LogLevel | "all" = "all";
    private unsubscribe: (() => void) | null = null;
    private listEl: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType(): string { return VIEW_TYPE_LOG; }
    getDisplayText(): string { return t("view.log"); }
    getIcon(): string { return "scroll-text"; }

    async onOpen(): Promise<void> {
        this.render();
        this.unsubscribe = onLogEntry((entry) => this.appendEntry(entry));
    }

    async onClose(): Promise<void> {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.contentEl.empty();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("tv-log-view");

        const header = contentEl.createDiv({ cls: "tv-log-header" });

        const filterGroup = header.createDiv({ cls: "tv-log-filters" });
        for (const level of ["all", ...LEVEL_LABELS] as const) {
            const btn = filterGroup.createEl("button", {
                text: level,
                cls: `tv-log-filter-btn${this.filter === level ? " is-active" : ""}`,
            });
            btn.addEventListener("click", () => {
                this.filter = level;
                this.render();
            });
        }

        const actions = header.createDiv({ cls: "tv-log-actions" });

        const copyBtn = actions.createEl("button", {
            cls: "tv-log-action-btn",
            attr: { "aria-label": "Copy visible log" },
        });
        setIcon(copyBtn, "copy");
        copyBtn.addEventListener("click", () => this.copyVisible());

        const clearBtn = actions.createEl("button", {
            cls: "tv-log-action-btn",
            attr: { "aria-label": "Clear log" },
        });
        setIcon(clearBtn, "trash-2");
        clearBtn.addEventListener("click", () => {
            clearLog();
            this.render();
        });

        this.listEl = contentEl.createDiv({ cls: "tv-log-list" });
        const entries = getLogEntries();
        for (let i = entries.length - 1; i >= 0; i--) {
            if (this.matchesFilter(entries[i])) {
                this.renderEntry(this.listEl, entries[i]);
            }
        }
    }

    private appendEntry(entry: LogEntry): void {
        if (!this.listEl || !this.matchesFilter(entry)) return;
        const row = this.createEntryEl(entry);
        this.listEl.insertBefore(row, this.listEl.firstChild);
    }

    private renderEntry(container: HTMLElement, entry: LogEntry): void {
        container.appendChild(this.createEntryEl(entry));
    }

    private createEntryEl(entry: LogEntry): HTMLElement {
        const row = document.createElement("div");
        row.className = `tv-log-entry tv-log-${entry.level}`;

        const time = row.createSpan({ cls: "tv-log-time" });
        time.textContent = formatTimestamp(entry.timestamp);

        const level = row.createSpan({ cls: "tv-log-level" });
        level.textContent = entry.level;

        const msg = row.createSpan({ cls: "tv-log-message" });
        msg.textContent = entry.message;

        return row;
    }

    private copyVisible(): void {
        const entries = getLogEntries().filter((e) => this.matchesFilter(e));
        const text = entries
            .map((e) => `${formatTimestamp(e.timestamp)} [${e.level.toUpperCase()}] ${e.message}`)
            .join("\n");
        navigator.clipboard.writeText(text).then(
            () => new Notice("Log copied to clipboard"),
            () => new Notice("Failed to copy log"),
        );
    }

    private matchesFilter(entry: LogEntry): boolean {
        if (this.filter === "all") return true;
        if (this.filter === "debug") return true;
        if (this.filter === "info") return entry.level !== "debug";
        if (this.filter === "warn") return entry.level === "warn" || entry.level === "error";
        return entry.level === this.filter;
    }
}
