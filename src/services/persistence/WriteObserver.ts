import type { WriteSink } from '../../utils/FileLines';

/**
 * Where the write layer tells the index what it did to a file's lines.
 *
 * A held reference rather than a module-level one, and connected after the
 * index has built its scanner rather than at construction. Both follow from the
 * same accident: a plugin that reloads without a restart can leave a previous
 * index alive for a while (#165), and a write filing its report with whichever
 * index a module variable happened to hold would be telling the wrong one.
 * Everything here is reachable only from the index that made it, and `dispose`
 * cuts the line — a write after that files nothing, which is what a scanner
 * that will never scan again deserves.
 */
export class WriteObserver {
    private resolve: ((file: string) => WriteSink) | null = null;

    connect(resolve: (file: string) => WriteSink): void {
        this.resolve = resolve;
    }

    disconnect(): void {
        this.resolve = null;
    }

    /** Where writes to `file` report, or undefined while nothing is listening. */
    for(file: string): WriteSink | undefined {
        return this.resolve?.(file);
    }
}
