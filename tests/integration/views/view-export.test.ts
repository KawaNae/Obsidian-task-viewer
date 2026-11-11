/**
 * A view's image export, in the running Dev vault: what a canvas in the view
 * shows is in the image, and a canvas that cannot be copied leaves the export
 * whole.
 *
 * The canvases are put into the body of a markdown frame of Timeline's
 * sidebar, as a chart a plugin draws there is: one painted a single color,
 * one of no size, a WebGL one, and one holding a picture from another origin
 * (fetched from the web; where it cannot be, that case is skipped). The view
 * is exported as the CLI's `export-image view=timeline` does it
 * (`exportOpenView`), and the saved PNG is read back pixel by pixel.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault open, with the current build
 *     loaded (`npm run build`, then reload the plugin)
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/view-export.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isObsidianRunning } from '../helpers/cli-helper';
import { deleteNotesUnder, framesOf, notesUnder } from '../helpers/markdown-frames';
import { SETTLE_MS, closeViews, ev, openView } from '../helpers/view-helper';

/** Every file of the test is under this: nothing else is written to or deleted. */
const PREFIX = 'SyncIgnore/test-int-export';
const NOTE = `${PREFIX}-chart`;
const FOLDER = `${PREFIX}-images`;
const NAME = 'export-tl';

/** The painted canvas: its size in CSS pixels, and its color. */
const W = 60;
const H = 40;
const PAINT = [255, 0, 255];
/** The export draws at twice the CSS pixels. */
const PIXEL_RATIO = 2;
/** An image from another origin, which taints a canvas it is drawn into. */
const FOREIGN_IMAGE = 'https://obsidian.md/images/obsidian-logo-gradient.svg';

interface Exported {
    /** The image's pixels of the painted canvas's color. */
    painted: number;
    /** Why the export failed; null when it was saved. */
    failure: string | null;
    /** Whether the canvas meant to hold another origin's picture is tainted. */
    tainted: boolean;
}

let exported: Exported;

beforeAll(() => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
    deleteNotesUnder(PREFIX);
    ev(`(async () => { ${notesUnder(PREFIX)} await writeNote(${JSON.stringify(`${NOTE}.md`)}, '## Chart\\nchart\\n'); return JSON.stringify(true); })()`);
    openView(NAME, 'timeline-view', {
        showSidebar: true,
        sidebar: [{ kind: 'markdown', id: 'chart', link: `${NOTE}#Chart` }],
    });
    exported = ev<Exported>(`(async () => {
        ${framesOf(PREFIX, NAME)}
        await wait(${SETTLE_MS});
        const body = bodyOf('chart');
        const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; body.appendChild(c); return c; };

        const painted = canvas(${W}, ${H});
        const ctx = painted.getContext('2d');
        ctx.fillStyle = 'rgb(${PAINT.join(',')})';
        ctx.fillRect(0, 0, ${W}, ${H});

        canvas(0, 0);

        const gl = canvas(20, 20).getContext('webgl');
        gl?.clearColor(0, 1, 0, 1);
        gl?.clear(gl.COLOR_BUFFER_BIT);

        const foreign = canvas(20, 20);
        let tainted = false;
        try {
            const img = new Image();
            img.src = ${JSON.stringify(FOREIGN_IMAGE)};
            await img.decode();
            foreign.getContext('2d').drawImage(img, 0, 0, 20, 20);
            try { foreign.toDataURL(); } catch { tainted = true; }
        } catch { /* not fetched: the case is skipped */ }

        // The export takes the first Timeline shown: it must be the test's.
        const shown = app.workspace.getLeavesOfType('timeline-view').filter(l => l.view.contentEl?.offsetWidth > 0);
        if (shown.length !== 1 || shown[0] !== R[${JSON.stringify(NAME)}]) throw new Error('another Timeline is shown beside the test\\'s');

        let path = null, failure = null;
        try {
            path = (await P.exportService.exportOpenView('timeline-view', { folder: ${JSON.stringify(FOLDER)}, filename: 'export.png' })).path;
        } catch (e) { failure = String(e?.message ?? e); }

        let count = 0;
        if (path) {
            const data = await app.vault.adapter.readBinary(path);
            const bitmap = await createImageBitmap(new Blob([data], { type: 'image/png' }));
            const c = document.createElement('canvas');
            c.width = bitmap.width; c.height = bitmap.height;
            const g = c.getContext('2d');
            g.drawImage(bitmap, 0, 0);
            const px = g.getImageData(0, 0, c.width, c.height).data;
            const [r, gr, b] = ${JSON.stringify(PAINT)};
            for (let i = 0; i < px.length; i += 4) {
                if (Math.abs(px[i] - r) <= 4 && Math.abs(px[i + 1] - gr) <= 4 && Math.abs(px[i + 2] - b) <= 4 && px[i + 3] === 255) count++;
            }
        }
        return JSON.stringify({ painted: count, failure, tainted });
    })()`);
});

afterAll(async () => {
    await closeViews();
    deleteNotesUnder(PREFIX);
});

describe('Timeline\'s image export', () => {
    it('is saved, beside a canvas of no size and a WebGL one', () => {
        expect(exported.failure).toBeNull();
    });

    it('shows what a canvas in the view shows', () => {
        const area = W * H * PIXEL_RATIO * PIXEL_RATIO;
        // The edges of the canvas may be smoothed into what is around it.
        expect(exported.painted).toBeGreaterThanOrEqual(area * 0.9);
        expect(exported.painted).toBeLessThanOrEqual(area * 1.1);
    });

    it('is saved beside a canvas holding a picture from another origin', (ctx) => {
        if (!exported.tainted) ctx.skip();
        expect(exported.failure).toBeNull();
    });
});
