import { assert } from "chai";
import { createPanelTabObserver } from "../src/modules/ui/chat-panel/PanelTabLifecycle.ts";

describe("panel tab lifecycle", function () {
  function setup(types = ["library", "reader"]) {
    let selectedID = "reader-tab";
    let tabTypes = types;
    let closed = 0;
    let synced = 0;
    const tabs = {
      get selectedID() {
        return selectedID;
      },
      getState: () => tabTypes.map((type) => ({ type, id: type, title: type })),
    };
    const observer = createPanelTabObserver(
      () => tabs,
      () => closed++,
      () => synced++,
    );
    return {
      notify: observer.notify,
      selectLibrary: () => (selectedID = "zotero-pane"),
      selectNote: () => (selectedID = "note-tab"),
      setTabs: (types: string[]) => (tabTypes = types),
      closed: () => closed,
      synced: () => synced,
    };
  }

  it("closes the panel after the last reader closes and returns to the library", function () {
    const state = setup();
    state.selectLibrary();
    state.notify("select");
    state.setTabs(["library"]);
    const previousSyncs = state.synced();
    state.notify("close");
    assert.equal(state.closed(), 1);
    assert.equal(state.synced(), previousSyncs);
    state.notify("close");
    assert.equal(state.closed(), 1);
  });

  it("retains reader history when an async select notification arrives after removal", function () {
    const state = setup();
    state.selectLibrary();
    state.setTabs(["library"]);
    state.notify("select");
    assert.equal(state.closed(), 0);
    state.notify("close");
    assert.equal(state.closed(), 1);
  });

  it("keeps the panel when other readers remain, even on the library tab", function () {
    const state = setup(["library", "reader", "reader"]);
    state.selectLibrary();
    state.setTabs(["library", "reader"]);
    state.notify("close");
    assert.equal(state.closed(), 0);
    assert.equal(state.synced(), 1);
  });

  it("does not treat unloaded or loading readers as closed", function () {
    for (const type of ["reader-unloaded", "reader-loading"]) {
      const state = setup(["library", "reader", type]);
      state.selectLibrary();
      state.setTabs(["library", type]);
      state.notify("close");
      assert.equal(state.closed(), 0);
    }
  });

  it("does not close the panel when manually switching to the library", function () {
    const state = setup();
    state.selectLibrary();
    state.notify("select");
    assert.equal(state.closed(), 0);
    assert.equal(state.synced(), 1);
  });

  it("keeps the panel when closing a note without any readers", function () {
    const state = setup(["library", "note"]);
    state.selectLibrary();
    state.setTabs(["library"]);
    state.notify("close");
    assert.equal(state.closed(), 0);
  });

  it("keeps the panel if the last reader closes into a note instead of the library", function () {
    const state = setup(["library", "reader", "note"]);
    state.selectNote();
    state.setTabs(["library", "note"]);
    state.notify("close");
    assert.equal(state.closed(), 0);
  });

  it("tracks readers opened after registration and supports close-all", function () {
    const state = setup(["library"]);
    state.setTabs(["library", "reader", "reader"]);
    state.notify("add");
    state.selectLibrary();
    state.setTabs(["library"]);
    state.notify("select");
    state.notify("close");
    assert.equal(state.closed(), 1);
  });

  it("ignores notifications when the main window tabs are unavailable", function () {
    let calls = 0;
    const observer = createPanelTabObserver(
      () => undefined,
      () => calls++,
      () => calls++,
    );
    observer.notify("close");
    assert.equal(calls, 0);
  });
});
