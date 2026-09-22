import { assert } from "chai";
import { ensureSetImmediate } from "../src/utils/setImmediatePolyfill.ts";

describe("setImmediate polyfill", function () {
  it("defines setImmediate when missing", function () {
    const global = globalThis as typeof globalThis & {
      setImmediate?: (...args: unknown[]) => unknown;
      clearImmediate?: (handle: unknown) => void;
    };
    const previousSetImmediate = global.setImmediate;
    const previousClearImmediate = global.clearImmediate;
    delete global.setImmediate;
    delete global.clearImmediate;

    try {
      ensureSetImmediate();
      assert.isFunction(global.setImmediate);
      assert.isFunction(global.clearImmediate);

      let called = false;
      const handle = global.setImmediate!(() => {
        called = true;
      });
      assert.ok(handle);
      return new Promise<void>((resolve, reject) => {
        global.setImmediate!(() => {
          try {
            assert.isTrue(called);
            global.clearImmediate!(handle);
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
    } finally {
      if (previousSetImmediate) {
        global.setImmediate = previousSetImmediate;
      } else {
        delete global.setImmediate;
      }
      if (previousClearImmediate) {
        global.clearImmediate = previousClearImmediate;
      } else {
        delete global.clearImmediate;
      }
    }
  });
});
