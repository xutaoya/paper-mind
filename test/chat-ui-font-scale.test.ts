import { assert } from "chai";
import {
  DEFAULT_CHAT_UI_FONT_SCALE,
  formatChatUIFontScaleLabel,
  normalizeChatUIFontScale,
} from "../src/modules/ui/chat-panel/chatUIFontScale.ts";

describe("chatUIFontScale", function () {
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
