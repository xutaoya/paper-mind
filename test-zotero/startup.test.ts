import { assert } from "chai";
import { config } from "../package.json";

describe("Zotero startup", function () {
  it("initializes the plugin instance", function () {
    assert.isNotEmpty(Zotero[config.addonInstance]);
    assert.isTrue(Zotero[config.addonInstance].data.initialized);
  });
});
