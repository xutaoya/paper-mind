import { assert } from "chai";
import { config } from "../package.json";
import { createDefaultQuickActions } from "../src/modules/chat/quick-actions/defaultQuickActions.ts";
import {
  deleteQuickAction,
  loadQuickActions,
  reorderQuickActionsByIds,
  upsertQuickAction,
} from "../src/modules/chat/quick-actions/QuickActionsStore.ts";

const PREFS_PREFIX = config.prefsPrefix;

describe("quick actions store", function () {
  const runtime = globalThis as Record<string, any>;
  let previousPrefs: unknown;

  beforeEach(function () {
    previousPrefs = runtime.Zotero;
    const prefs = new Map<string, unknown>();
    runtime.Zotero = {
      Prefs: {
        get: (key: string) => prefs.get(key),
        set: (key: string, value: unknown) => {
          prefs.set(key, value);
        },
      },
    };
  });

  afterEach(function () {
    runtime.Zotero = previousPrefs;
  });

  it("returns the default paper explanation shortcut when unset", function () {
    const actions = loadQuickActions();
    assert.lengthOf(actions, 1);
    assert.equal(actions[0]?.label, "论文讲解");
    assert.include(actions[0]?.prompt, "帮我用中文详细讲解这个论文");
  });

  it("persists edited shortcuts", function () {
    const defaults = createDefaultQuickActions();
    upsertQuickAction({
      ...defaults[0],
      label: "精读论文",
      prompt: "请精读这篇论文并输出结构化笔记",
    });

    const reloaded = loadQuickActions();
    assert.equal(reloaded[0]?.label, "精读论文");
    assert.equal(reloaded[0]?.prompt, "请精读这篇论文并输出结构化笔记");
    assert.isString(runtime.Zotero.Prefs.get(`${PREFS_PREFIX}.quickActions`));
  });

  it("appends newly created shortcuts", function () {
    upsertQuickAction({
      id: "paper-explain",
      label: "论文讲解",
      prompt: "讲解这篇论文",
    });
    upsertQuickAction({
      id: "action-summary-1",
      label: "要点总结",
      prompt: "总结这篇论文要点",
    });

    const actions = loadQuickActions();
    assert.lengthOf(actions, 2);
    assert.deepEqual(
      actions.map((action) => action.label),
      ["论文讲解", "要点总结"],
    );
  });

  it("reorders shortcuts by id list", function () {
    upsertQuickAction({
      id: "paper-explain",
      label: "论文讲解",
      prompt: "讲解这篇论文",
    });
    upsertQuickAction({
      id: "action-summary-1",
      label: "要点总结",
      prompt: "总结这篇论文要点",
    });
    upsertQuickAction({
      id: "action-translate-1",
      label: "翻译摘要",
      prompt: "翻译这篇论文摘要",
    });

    const reordered = reorderQuickActionsByIds([
      "action-translate-1",
      "paper-explain",
      "action-summary-1",
    ]);
    assert.deepEqual(
      reordered.map((action) => action.id),
      ["action-translate-1", "paper-explain", "action-summary-1"],
    );
    assert.deepEqual(
      loadQuickActions().map((action) => action.id),
      ["action-translate-1", "paper-explain", "action-summary-1"],
    );
  });

  it("deletes a shortcut by id", function () {
    upsertQuickAction({
      id: "paper-explain",
      label: "论文讲解",
      prompt: "讲解这篇论文",
    });
    upsertQuickAction({
      id: "action-summary-1",
      label: "要点总结",
      prompt: "总结这篇论文要点",
    });
    upsertQuickAction({
      id: "action-translate-1",
      label: "翻译摘要",
      prompt: "翻译这篇论文摘要",
    });

    const remaining = deleteQuickAction("action-summary-1");
    assert.deepEqual(
      remaining.map((action) => action.id),
      ["paper-explain", "action-translate-1"],
    );
    assert.deepEqual(
      loadQuickActions().map((action) => action.id),
      ["paper-explain", "action-translate-1"],
    );
  });

  it("keeps an empty list after deleting the last shortcut", function () {
    upsertQuickAction({
      id: "paper-explain",
      label: "论文讲解",
      prompt: "讲解这篇论文",
    });

    const remaining = deleteQuickAction("paper-explain");
    assert.lengthOf(remaining, 0);
    assert.lengthOf(loadQuickActions(), 0);
  });
});
