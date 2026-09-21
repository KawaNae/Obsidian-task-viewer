import type { WriteChannel } from '../../utils/FileLines';

/**
 * Where the write layer asks the index where a named row stands, tells it what
 * it did to a file's lines, and says when it gave a write up.
 *
 * A held reference rather than a module-level one, and connected after the
 * index has built its scanner rather than at construction. Both follow from the
 * same accident: a plugin that reloads without a restart can leave a previous
 * index alive for a while (#165), and a write filing its report with whichever
 * index a module variable happened to hold would be telling the wrong one.
 * Everything here is reachable only from the index that made it, and `dispose`
 * cuts the line — a write after that files nothing, which is what a scanner
 * that will never scan again deserves, and finds no target, because nothing
 * is left to say where one stands.
 */
export class WriteObserver {
    private resolve: ((file: string) => WriteChannel) | null = null;

    connect(resolve: (file: string) => WriteChannel): void {
        this.resolve = resolve;
    }

    disconnect(): void {
        this.resolve = null;
    }

    /** The channel for writes to `file`, or undefined while nothing is listening. */
    for(file: string): WriteChannel | undefined {
        return this.resolve?.(file);
    }
}
