import { readFileSync } from "node:fs";
import { assert } from "chai";
import { bindPreferencesSectionNav } from "../src/modules/preferences/PreferencesSectionNav.ts";

describe("preferences section navigation", function () {
  it("defines navigation and one panel per settings section", function () {
    const markup = readFileSync(
      new URL("../addon/content/preferences.xhtml", import.meta.url),
      "utf8",
    );

    assert.include(markup, 'id="pref-section-nav"');
    assert.include(markup, 'data-pref-section="models"');
    assert.include(markup, 'data-pref-section="pdf"');
    assert.include(markup, 'data-pref-section="web-search"');
    assert.include(markup, 'data-pref-section="ui"');
    assert.include(markup, 'data-pref-section="ai-tools"');
    assert.include(markup, 'data-pref-section="skills"');
    assert.include(markup, 'data-pref-section="aisummary"');
    assert.include(
      markup,
      'href="chrome://__addonRef__/content/paperchat-preferences.css"',
    );
  });

  it("binds section navigation only once", function () {
    let clickHandler: ((event: Event) => void) | null = null;
    const nav = {
      getAttribute: () => "true",
      setAttribute: () => undefined,
      addEventListener: (_type: string, handler: (event: Event) => void) => {
        clickHandler = handler;
      },
      contains: () => true,
      querySelectorAll: () => [],
    };

    const doc = {
      getElementById: (id: string) => (id === "pref-section-nav" ? nav : null),
      defaultView: {
        sessionStorage: {
          setItem: () => undefined,
          getItem: () => null,
        },
      },
    } as unknown as Document;

    bindPreferencesSectionNav(doc);
    bindPreferencesSectionNav(doc);

    assert.equal(nav.getAttribute("data-bound"), "true");
  });
});
