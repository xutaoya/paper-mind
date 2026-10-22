import { assert } from "chai";
import {
  DEFAULT_CHAT_UI_FONT_SCALE,
  formatChatUIFontScaleLabel,
  normalizeChatUIFontScale,
  monitorChatPanelRoot,
  unmonitorChatPanelRoot,
  refreshAllChatPanelFontScales,
} from "../src/modules/ui/chat-panel/chatUIFontScale.ts";

describe("chatUIFontScale", function () {
  let originalZotero: unknown;
  const roots: HTMLElement[] = [];

  beforeEach(function () {
    originalZotero = (globalThis as any).Zotero;
    (globalThis as any).Zotero = {
      Prefs: { get: () => 120 },
      getMainWindows: () => [],
    };
  });

  afterEach(function () {
    roots.splice(0).forEach(unmonitorChatPanelRoot);
    (globalThis as any).Zotero = originalZotero;
  });

  function root() {
    let writes = 0;
    const element = {
      isConnected: true,
      ownerDocument: { defaultView: { closed: false } },
      style: {
        set zoom(_value: string) {
          writes++;
        },
      },
    };
    roots.push(element as unknown as HTMLElement);
    return { element, writes: () => writes };
  }

  it("stops refreshing disposed roots without waiting for garbage collection", function () {
    const tracked = root();
    const element = tracked.element as unknown as HTMLElement;
    monitorChatPanelRoot(element);
    unmonitorChatPanelRoot(element);
    refreshAllChatPanelFontScales();
    assert.equal(tracked.writes(), 1);
  });

  it("does not retain duplicate registrations or refresh a closed window", function () {
    const tracked = root();
    const element = tracked.element as unknown as HTMLElement;
    monitorChatPanelRoot(element);
    monitorChatPanelRoot(element);
    refreshAllChatPanelFontScales();
    assert.equal(tracked.writes(), 3);
    tracked.element.ownerDocument.defaultView.closed = true;
    refreshAllChatPanelFontScales();
    tracked.element.ownerDocument.defaultView.closed = false;
    refreshAllChatPanelFontScales();
    assert.equal(
      tracked.writes(),
      3,
      "closed roots are removed, not just skipped",
    );
    monitorChatPanelRoot(element);
    refreshAllChatPanelFontScales();
    assert.equal(tracked.writes(), 5, "can register again after pruning");
  });

  it("normalizes chat panel scale to 10% steps within 80-180", function () {
    assert.equal(
      normalizeChatUIFontScale(undefined),
      DEFAULT_CHAT_UI_FONT_SCALE,
    );
    assert.equal(normalizeChatUIFontScale(100), 100);
    assert.equal(normalizeChatUIFontScale(84), 80);
    assert.equal(normalizeChatUIFontScale(86), 90);
    assert.equal(normalizeChatUIFontScale(175), 180);
    assert.equal(normalizeChatUIFontScale(40), 80);
    assert.equal(normalizeChatUIFontScale(250), 180);
  });

  it("formats scale labels as percentages", function () {
    assert.equal(formatChatUIFontScaleLabel(120), "120%");
    assert.equal(formatChatUIFontScaleLabel("86"), "90%");
  });
});
