import { assert } from "chai";
import { ChatManager } from "../src/modules/chat/ChatManager.ts";

describe("chat UI callback cleanup", function () {
  it("releases a disposed history callback without clearing a replacement", function () {
    const manager = Object.create(ChatManager.prototype) as any;
    const oldCallback = () => undefined;
    const currentCallback = () => undefined;
    const disposeOld = manager.setSessionListUpdateCallback(oldCallback);
    const disposeCurrent =
      manager.setSessionListUpdateCallback(currentCallback);
    disposeOld();
    assert.strictEqual(manager.onSessionListUpdate, currentCallback);
    disposeCurrent();
    assert.isUndefined(manager.onSessionListUpdate);
    disposeCurrent();
    assert.isUndefined(manager.onSessionListUpdate);
  });
});
