/**
 * Mobile virtual keyboard awareness for fixed-position containers.
 *
 * Adjusts a container's height and top to match the visual viewport when a
 * soft keyboard opens (detected via visualViewport.resize). On desktop
 * Electron, visualViewport exists but the keyboard never appears, so the
 * utility is harmless.
 *
 * Also scrolls the focused input into view after the keyboard animation
 * settles, so bottom-of-panel inputs remain accessible.
 */
export class KeyboardAwareContainer {
    private vvHandler: (() => void) | null = null;
    private focusHandler: ((e: FocusEvent) => void) | null = null;

    constructor(
        private container: HTMLElement,
        private win: Window,
    ) {}

    attach(): void {
        const vv = this.win.visualViewport;
        if (!vv) return;

        this.vvHandler = () => {
            const fullH = this.win.innerHeight;
            const visH = vv.height;
            const visTop = vv.offsetTop;

            if (Math.abs(fullH - visH) < 1) {
                this.container.style.height = '';
                this.container.style.top = '';
            } else {
                this.container.style.height = `${visH}px`;
                this.container.style.top = `${visTop}px`;
            }
        };
        vv.addEventListener('resize', this.vvHandler);

        this.focusHandler = (e: FocusEvent) => {
            const target = e.target;
            if (!(target instanceof HTMLInputElement ||
                  target instanceof HTMLTextAreaElement)) return;
            // 300ms: typical iOS/Android keyboard animation duration
            setTimeout(() => {
                target.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }, 300);
        };
        this.container.addEventListener('focusin', this.focusHandler);
    }

    detach(): void {
        const vv = this.win.visualViewport;
        if (vv && this.vvHandler) {
            vv.removeEventListener('resize', this.vvHandler);
        }
        if (this.focusHandler) {
            this.container.removeEventListener('focusin', this.focusHandler);
        }
        this.vvHandler = null;
        this.focusHandler = null;
        this.container.style.height = '';
        this.container.style.top = '';
    }
}
