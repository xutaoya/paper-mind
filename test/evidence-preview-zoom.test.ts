import { assert } from "chai";
import { setupEvidencePreviewZoom } from "../src/modules/ui/chat-panel/EvidencePreviewZoom.ts";

class ZoomElement {
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  listeners = new Map<string, (event: any) => void>();
  listenerOptions = new Map<string, unknown>();
  clientWidth = 300;
  clientHeight = 200;
  scrollLeft = 0;
  scrollTop = 0;
  getBoundingClientRect() {
    return { left: 10, top: 20 };
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  addEventListener(
    name: string,
    handler: (event: any) => void,
    options?: unknown,
  ) {
    this.listeners.set(name, handler);
    this.listenerOptions.set(name, options);
  }
  fire(name: string, values: Record<string, unknown> = {}) {
    const result = { prevented: false, stopped: false };
    this.listeners.get(name)?.({
      clientX: 110,
      clientY: 95,
      deltaMode: 0,
      preventDefault: () => {
        result.prevented = true;
      },
      stopPropagation: () => {
        result.stopped = true;
      },
      ...values,
    });
    return result;
  }
}

describe("evidence preview pinch zoom", function () {
  function fixture() {
    const viewport = new ZoomElement();
    const image = new ZoomElement();
    setupEvidencePreviewZoom(
      viewport as unknown as HTMLElement,
      image as unknown as HTMLImageElement,
    );
    return { viewport, image };
  }

  it("zooms smoothly around the gesture position without zooming the application", function () {
    const { viewport, image } = fixture();
    viewport.scrollLeft = 40;
    viewport.scrollTop = 80;
    const result = viewport.fire("wheel", {
      ctrlKey: true,
      deltaY: -Math.log(2) / 0.01,
    });
    assert.equal(image.style.width, "200%");
    assert.closeTo(viewport.scrollLeft, 180, 0.001);
    assert.closeTo(viewport.scrollTop, 235, 0.001);
    assert.isTrue(result.prevented);
    assert.isTrue(result.stopped);
    assert.deepEqual(viewport.listenerOptions.get("wheel"), { passive: false });
  });

  it("leaves ordinary two-finger scrolling and mouse wheel scrolling native", function () {
    const { viewport, image } = fixture();
    const result = viewport.fire("wheel", {
      ctrlKey: false,
      deltaY: 100,
      deltaX: 20,
    });
    assert.isFalse(result.prevented);
    assert.isFalse(result.stopped);
    assert.isUndefined(image.style.width);
  });

  it("limits zoom to the fitted image through 4x and resets its scroll position", function () {
    const { viewport, image } = fixture();
    for (let i = 0; i < 10; i++)
      viewport.fire("wheel", { ctrlKey: true, deltaY: -1000 });
    assert.equal(image.style.width, "400%");
    for (let i = 0; i < 10; i++)
      viewport.fire("wheel", { ctrlKey: true, deltaY: 1000 });
    assert.equal(image.style.width, "100%");
    assert.equal(viewport.scrollLeft, 0);
    assert.equal(viewport.scrollTop, 0);
  });

  it("keeps click and keyboard zoom available after a pinch gesture", function () {
    const { viewport, image } = fixture();
    image.fire("keydown", { key: "Enter" });
    assert.equal(image.style.width, "250%");
    image.fire("click");
    assert.equal(image.style.width, "100%");
    viewport.fire("wheel", { ctrlKey: true, deltaY: -30 });
    assert.equal(image.attributes.get("aria-pressed"), "true");
    image.fire("keydown", { key: " " });
    assert.equal(image.style.width, "100%");
  });
});
