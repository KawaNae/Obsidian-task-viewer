export class AutoScroller {
    private container: HTMLElement;
    private autoScrollFrameId: number | null = null;
    private autoScrollSpeed: number = 0;
    private onScrollCallback: (delta: number) => void;

    constructor(container: HTMLElement, onScrollCallback: (delta: number) => void) {
        this.container = container;
        this.onScrollCallback = onScrollCallback;
    }

    public handleAutoScroll(clientY: number) {
        const scrollArea = this.container.querySelector('.timeline-scroll-area');
        if (!scrollArea) return;

        const scrollRect = scrollArea.getBoundingClientRect();
        const scrollThreshold = 50; // px from edge
        const maxSpeed = 15; // px per frame

        if (clientY < scrollRect.top + scrollThreshold) {
            // Scroll Up
            const distance = Math.max(0, (scrollRect.top + scrollThreshold) - clientY);
            const ratio = Math.min(1, distance / scrollThreshold);
            this.autoScrollSpeed = -maxSpeed * ratio;
        } else if (clientY > scrollRect.bottom - scrollThreshold) {
            // Scroll Down
            const distance = Math.max(0, clientY - (scrollRect.bottom - scrollThreshold));
            const ratio = Math.min(1, distance / scrollThreshold);
            this.autoScrollSpeed = maxSpeed * ratio;
        } else {
            this.autoScrollSpeed = 0;
        }

        if (this.autoScrollSpeed !== 0 && this.autoScrollFrameId === null) {
            this.startAutoScrollLoop();
        } else if (this.autoScrollSpeed === 0 && this.autoScrollFrameId !== null) {
            this.stopAutoScrollLoop();
        }
    }

    public stop() {
        this.stopAutoScrollLoop();
    }

    private startAutoScrollLoop() {
        const loop = () => {
            if (this.autoScrollSpeed === 0) {
                this.stopAutoScrollLoop();
                return;
            }

            const scrollArea = this.container.querySelector('.timeline-scroll-area');
            if (scrollArea) {
                const startScrollTop = scrollArea.scrollTop;
                scrollArea.scrollTop += this.autoScrollSpeed;
                const actualScroll = scrollArea.scrollTop - startScrollTop;

                if (actualScroll !== 0) {
                    this.onScrollCallback(actualScroll);
                }
            }

            this.autoScrollFrameId = requestAnimationFrame(loop);
        };
        this.autoScrollFrameId = requestAnimationFrame(loop);
    }

    private stopAutoScrollLoop() {
        if (this.autoScrollFrameId !== null) {
            cancelAnimationFrame(this.autoScrollFrameId);
            this.autoScrollFrameId = null;
        }
    }
}
