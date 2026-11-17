/**
 * What the E2E vault holds beyond what Obsidian makes in an empty folder.
 * The vault is emptied and written from this on every run (`rebuild.ts`),
 * so a test rests on nothing but this and what it sets up itself.
 *
 * Only what differs from the defaults is written here. Obsidian makes the
 * rest when it opens the folder: its settings, appearance and core plugins
 * as a new vault has them, and a workspace of one tab with the left sidebar
 * open and the right one collapsed. The workspace is not written here as a
 * file: Obsidian names its ribbon items in the display language, which
 * this definition would then hold.
 *
 * Task Viewer is built from the checkout's source on every run and starts
 * with no `data.json`, as just installed. A test that needs a setting other
 * than the default sets it itself, so what it rests on is written in it.
 */

/** Task Viewer, the plugin under test, built from this checkout. */
export const TASK_VIEWER_ID = 'obsidian-task-viewer';

/**
 * A plugin by another author, copied from the machine's store of them
 * (`E2E_PATHS.plugins` in `dev-paths.mjs`) at the version given. The files
 * are not in the repository; each is checked against its hash before it is
 * copied, so a later release of the plugin, or a file changed in the store,
 * does not run in the vault.
 */
export interface StoredPlugin {
    id: string;
    version: string;
    /** SHA-256, in hex, of each file the plugin is made of. */
    sha256: Record<string, string>;
}

export const STORED_PLUGINS: readonly StoredPlugin[] = [
    // markdown-frames.test.ts: a card of a markdown frame draws a DataviewJS
    // block, and a Dataview task list whose checkbox Dataview writes.
    {
        id: 'dataview',
        version: '0.5.68',
        sha256: {
            'main.js': 'bcdb7a7882051a30427a3fa370533c1052019591e7551bcc12611bb9a726bbb3',
            'manifest.json': '9235db47112da81b85591c79ecb9ae2574e5e72207056e976472f90616286185',
            'styles.css': '3306dd9032e00f989ba7233a37fd255bc4d3f4340cee661762e952f3f6aa1de9',
        },
    },
];

/**
 * The files written into the vault, by their path in it. Each value differs
 * from what Obsidian or the plugin uses when the file is not there.
 */
export const VAULT_FILES: Readonly<Record<string, string>> = {
    // Obsidian loads the community plugins listed here; none by default.
    '.obsidian/community-plugins.json': JSON.stringify([TASK_VIEWER_ID, ...STORED_PLUGINS.map(p => p.id)]),
    // markdown-frames.test.ts (the frame of a section whose headings hold
    // Dataview blocks) draws a DataviewJS block, which Dataview runs only
    // when JavaScript queries are on; they are off by default. Dataview
    // takes the defaults for the keys not written.
    '.obsidian/plugins/dataview/data.json': JSON.stringify({ enableDataviewJs: true }),
};
