/**
 * What a test file puts back after itself, run as one list.
 *
 * Each step is added as soon as there is something for it to undo (the
 * settings changed, a note written, views about to be opened), and `run`
 * calls them in the reverse order, each in a try of its own. A step that
 * throws (an `obsidian eval` that timed out while closing the views) does
 * not keep the later ones from running, so the settings a file changed are
 * put back even when a step before them failed. What failed is thrown once
 * every step has run.
 */
export interface Teardown {
    /** Add a step, named for the error that says it failed. */
    add(name: string, step: () => unknown): void;
    /** Run the steps added, the last one first, and forget them. */
    run(): Promise<void>;
}

export function createTeardown(): Teardown {
    const steps: { name: string; step: () => unknown }[] = [];
    return {
        add(name, step) {
            steps.push({ name, step });
        },
        async run() {
            const failed: string[] = [];
            for (const { name, step } of steps.splice(0).reverse()) {
                try {
                    await step();
                } catch (err) {
                    failed.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
            if (failed.length > 0) throw new Error(`teardown failed in ${failed.length} step(s):\n${failed.join('\n')}`);
        },
    };
}
