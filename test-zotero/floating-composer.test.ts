import { assert } from "chai";
import { config } from "../package.json";
import { getString } from "../src/utils/locale";
import { createChatContainer } from "../src/modules/ui/chat-panel/ChatPanelBuilder";
import {
  lightTheme,
  darkTheme,
} from "../src/modules/ui/chat-panel/ChatPanelTheme";
import { applyComposerChromeTheme } from "../src/modules/ui/chat-panel/ComposerTheme";
import { unmonitorChatPanelRoot } from "../src/modules/ui/chat-panel/chatUIFontScale";
import {
  setupFloatingWindowPin,
  setFloatingWindowPinned,
} from "../src/modules/ui/chat-panel/FloatingWindowPin";
import { renderMarkdownToElement } from "../src/modules/ui/chat-panel/MarkdownRenderer";

describe("floating composer styles in Zotero", function () {
  this.timeout(10000);
  let addonDescriptor: PropertyDescriptor | undefined;
  let win: Window;
  let container: HTMLElement;

  before(function () {
    addonDescriptor = Object.getOwnPropertyDescriptor(globalThis, "addon");
    Object.defineProperty(globalThis, "addon", {
      configurable: true,
      get: () => Zotero[config.addonInstance],
    });
  });

  after(function () {
    if (addonDescriptor)
      Object.defineProperty(globalThis, "addon", addonDescriptor);
    else delete (globalThis as any).addon;
  });

  beforeEach(async function () {
    win = (
      Zotero.getMainWindow() as unknown as {
        openDialog: (...args: unknown[]) => Window;
      }
    ).openDialog(
      `chrome://${config.addonRef}/content/chatWindow.xhtml`,
      "paperchat-floating-composer-test",
      "chrome,dialog=no,resizable=yes,width=420,height=600",
    );
    await new Promise<void>((resolve) =>
      win.addEventListener("load", () => resolve(), { once: true }),
    );
    container = createChatContainer(win.document, lightTheme);
    win.document.getElementById("chat-window-root")!.appendChild(container);
    Object.assign(container.style, {
      display: "block",
      position: "relative",
      width: "100%",
      height: "100%",
    });
    (container.querySelector("#chat-drag-bar") as HTMLElement).style.display =
      "none";
  });

  afterEach(function () {
    unmonitorChatPanelRoot(
      container.querySelector(".chat-panel-root") as HTMLElement,
    );
    win.close();
  });

  it("loads the focus layer without intercepting pointer input", function () {
    const effect = container.querySelector(".chat-composer-focus-fx")!;
    assert.equal(win.getComputedStyle(effect).position, "absolute");
    assert.equal(win.getComputedStyle(effect).pointerEvents, "none");
    assert.equal(win.getComputedStyle(effect).opacity, "0");
    assert.equal(effect.getAttribute("aria-hidden"), "true");
  });

  it("keeps long MathML above a thin scrollbar in floating and sidebar modes", function () {
    const main = Zotero.getMainWindow();
    const sidebar = createChatContainer(main.document, lightTheme);
    Object.assign(sidebar.style, { display: "block", width: "320px" });
    const formula = String.raw`$$q(x_t\mid x_{t-1}),\quad q(x_t\mid x_{t-1})=\mathcal{N}\left(x_t;\sqrt{1-\beta_t}\,x_{t-1},\beta_t\mathbf{I}\right)\tag{3}$$`;
    try {
      for (const panel of [container, sidebar]) {
        panel.classList.add("chat-container");
        const doc = panel.ownerDocument;
        const view = doc.defaultView!;
        const host = doc.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "div",
        ) as HTMLElement;
        host.className = "chat-content";
        host.style.width = "240px";
        panel.querySelector("#chat-history")!.appendChild(host);
        renderMarkdownToElement(host, formula);
        const scroll = host.querySelector<HTMLElement>(".md-math-scroll")!;
        const math = scroll.querySelector("math")!;
        assert.isNotNull(math, "real MathML, not a raw LaTeX fallback");
        for (const theme of ["light", "dark"]) {
          panel.dataset.theme = theme;
          const style = view.getComputedStyle(scroll);
          assert.equal(style.scrollbarWidth, "thin");
          assert.equal(style.paddingBottom, "12px");
          assert.include(
            style.scrollbarColor,
            theme === "dark" ? "203, 213, 225" : "100, 116, 139",
          );
          assert.isAbove(
            scroll.scrollWidth,
            scroll.clientWidth,
            "long formula can scroll",
          );
          for (const left of [0, scroll.scrollWidth]) {
            scroll.scrollLeft = left;
            const rect = scroll.getBoundingClientRect();
            const mathRect = math.getBoundingClientRect();
            assert.isAtLeast(
              rect.bottom - mathRect.bottom,
              11,
              "reserved gap below every glyph",
            );
            assert.isAtLeast(
              mathRect.top - rect.top,
              3,
              "top of tall formulas is not clipped",
            );
          }
          assert.isAbove(scroll.scrollLeft, 0);
          const glyphs = math.querySelectorAll("mo, mi, mn, mtext");
          const lastGlyph = glyphs[glyphs.length - 1];
          assert.isAtMost(
            lastGlyph.getBoundingClientRect().right,
            scroll.getBoundingClientRect().right + 1,
            "equation number remains reachable",
          );
        }
      }
    } catch (error) {
      const failure = new Error(String(error));
      Object.defineProperty(failure, "message", {
        value: String(error),
        enumerable: true,
      });
      throw failure;
    } finally {
      unmonitorChatPanelRoot(
        sidebar.querySelector(".chat-panel-root") as HTMLElement,
      );
      sidebar.remove();
    }
  });

  it("uses identical heading sizes and spacing in floating and sidebar documents", function () {
    const main = Zotero.getMainWindow();
    const sidebar = createChatContainer(main.document, lightTheme);
    sidebar.style.display = "block";
    const markdown =
      "# 一级标题\n\n正文保持原样。\n\n## 二级标题\n\n### 三级标题\n\n#### 四级标题\n\n##### 五级标题\n\n###### 六级标题";
    const addContent = (panel: HTMLElement) => {
      const host = panel.ownerDocument.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "div",
      ) as HTMLElement;
      host.setAttribute("class", "chat-content");
      host.style.lineHeight = "1.6";
      panel.querySelector("#chat-history")!.appendChild(host);
      renderMarkdownToElement(host, markdown);
      return host;
    };
    try {
      const floatingContent = addContent(container);
      const sidebarContent = addContent(sidebar);
      // Reasoning uses Markdown outside the main answer's .chat-content.
      const floatingReasoning = win.document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "div",
      ) as HTMLElement;
      container.querySelector("#chat-history")!.appendChild(floatingReasoning);
      renderMarkdownToElement(floatingReasoning, "# 思考中的标题");
      for (const theme of [lightTheme, darkTheme]) {
        applyComposerChromeTheme(container, theme);
        applyComposerChromeTheme(sidebar, theme);
        for (let level = 1; level <= 6; level++) {
          const floatingHeading = floatingContent.querySelector(`h${level}`)!;
          const sidebarHeading = sidebarContent.querySelector(`h${level}`)!;
          const baselineHeading = sidebarHeading.cloneNode(true) as HTMLElement;
          baselineHeading.removeAttribute("class");
          sidebarContent.appendChild(baselineHeading);
          const floatingStyle = win.getComputedStyle(floatingHeading);
          const sidebarStyle = main.getComputedStyle(sidebarHeading);
          const baselineStyle = main.getComputedStyle(baselineHeading);
          const properties = [
            "font-size",
            "font-weight",
            "line-height",
            "margin-top",
            "margin-bottom",
          ];
          const snapshot = (style: CSSStyleDeclaration) =>
            Object.fromEntries(
              properties.map((name) => [name, style.getPropertyValue(name)]),
            );
          assert.deepEqual(
            snapshot(floatingStyle),
            snapshot(baselineStyle),
            `h${level} must follow the original sidebar: ${JSON.stringify(snapshot(baselineStyle))}`,
          );
          assert.deepEqual(
            snapshot(sidebarStyle),
            snapshot(baselineStyle),
            `h${level} sidebar must not be redesigned`,
          );
          baselineHeading.remove();
        }
        assert.equal(
          win.getComputedStyle(floatingContent.querySelector("p")!).fontSize,
          "13px",
        );
        assert.equal(
          main.getComputedStyle(sidebarContent.querySelector("p")!).fontSize,
          "13px",
        );
        assert.equal(
          win.getComputedStyle(floatingReasoning.querySelector("h1")!).fontSize,
          main.getComputedStyle(sidebarContent.querySelector("h1")!).fontSize,
        );
      }
    } catch (error) {
      const failure = new Error(String(error));
      Object.defineProperty(failure, "message", {
        value: String(error),
        enumerable: true,
      });
      throw failure;
    } finally {
      unmonitorChatPanelRoot(
        sidebar.querySelector(".chat-panel-root") as HTMLElement,
      );
      sidebar.remove();
    }
  });

  it("pins the existing native window and unpins without losing a draft or conversation", async function () {
    // GTK can realize the native window after the chrome document's load event.
    // Wait for that lifecycle boundary before testing the user's click action.
    const Ci = Components.interfaces;
    const nativeWindow = (win as any).docShell.treeOwner
      .QueryInterface(Ci.nsIInterfaceRequestor)
      .getInterface(Ci.nsIAppWindow)
      .QueryInterface(Ci.nsIBaseWindow);
    const deadline = Date.now() + 2000;
    const isReady = () =>
      /^0x[0-9a-f]+$/i.test(nativeWindow.nativeHandle) &&
      !/^0x0+$/i.test(nativeWindow.nativeHandle);
    while (!isReady() && Date.now() < deadline) {
      await new Promise<void>((resolve) => win.setTimeout(resolve, 20));
    }
    assert.isTrue(
      isReady(),
      `Native handle after load: ${JSON.stringify(nativeWindow.nativeHandle)}`,
    );
    try {
      setFloatingWindowPinned(win, true);
      setFloatingWindowPinned(win, false);
    } catch (error) {
      const failure = new Error(String(error));
      Object.defineProperty(failure, "message", {
        value: String(error),
        enumerable: true,
      });
      throw failure;
    }
    const button = container.querySelector<HTMLButtonElement>(
      "#chat-window-pin-btn",
    )!;
    assert.equal(win.getComputedStyle(button).display, "none");
    setupFloatingWindowPin(container, win);
    assert.equal(win.getComputedStyle(button).display, "flex");
    const input = container.querySelector<HTMLTextAreaElement>(
      "#chat-message-input",
    )!;
    input.value = "unsent draft";
    const history = container.querySelector("#chat-history")!;
    const originalDoc = win.document;
    try {
      for (const theme of [lightTheme, darkTheme]) {
        applyComposerChromeTheme(container, theme);
        const idleColor = win.getComputedStyle(button).color;
        button.click();
        assert.equal(button.getAttribute("aria-pressed"), "true");
        assert.notEqual(win.getComputedStyle(button).color, idleColor);
        assert.equal(button.title, getString("chat-unpin-window"));
        assert.strictEqual(win.document, originalDoc);
        assert.strictEqual(container.querySelector("#chat-history"), history);
        assert.equal(input.value, "unsent draft");
        button.click();
        assert.equal(button.getAttribute("aria-pressed"), "false");
        assert.equal(win.getComputedStyle(button).color, idleColor);
      }
    } catch (error) {
      const failure = new Error(String(error));
      Object.defineProperty(failure, "message", {
        value: String(error),
        enumerable: true,
      });
      throw failure;
    } finally {
      try {
        setFloatingWindowPinned(win, false);
      } catch {
        // The fixture closes the window even if a native call failed.
      }
    }
  });

  it("uses unique SVG gradients and the border's shared rainbow palette", function () {
    const doc = win.document;
    const second = createChatContainer(doc, lightTheme);
    doc.getElementById("chat-window-root")!.appendChild(second);
    try {
      const gradients = [container, second].flatMap((panel) =>
        Array.from(
          panel.querySelectorAll(".chat-composer-focus-fx linearGradient"),
        ),
      );
      assert.lengthOf(gradients, 4);
      assert.equal(new Set(gradients.map((gradient) => gradient.id)).size, 4);
      for (const gradient of gradients) {
        assert.equal(gradient.getAttribute("gradientUnits"), "userSpaceOnUse");
        const stops = [...gradient.querySelectorAll("stop")];
        assert.lengthOf(stops, 7);
        assert.equal(
          new Set(stops.map((stop) => win.getComputedStyle(stop).stopColor))
            .size,
          7,
        );
      }
      const stroke = container
        .querySelector(".chat-composer-focus-glint path")!
        .getAttribute("stroke")!;
      const fill = container
        .querySelector(".chat-composer-focus-sparks")!
        .getAttribute("fill")!;
      for (const paint of [stroke, fill]) {
        assert.match(paint, /^url\(#paperchat-composer-spectrum-\d+\)$/);
        assert.isNotNull(doc.getElementById(paint.slice(5, -1)));
      }
    } finally {
      unmonitorChatPanelRoot(
        second.querySelector(".chat-panel-root") as HTMLElement,
      );
      second.remove();
    }
  });

  it("fades focus in and out without cycling in either theme", async function () {
    const input = container.querySelector<HTMLTextAreaElement>(
      "#chat-message-input",
    )!;
    const wrapper = container.querySelector<HTMLElement>(
      "#chat-input-wrapper",
    )!;
    const effect = container.querySelector(".chat-composer-focus-fx")!;
    const glint = effect.querySelector(".chat-composer-focus-glint path")!;
    const reduced = win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const view = win.document.defaultView!;
    const settle = () =>
      new Promise<void>((resolve) => win.setTimeout(resolve, 350));

    for (const theme of ["light", "dark"]) {
      wrapper.dataset.theme = theme;
      // Isolated test windows may not own OS focus.
      assert.equal(win.getComputedStyle(effect).opacity, "0");
      input.dispatchEvent(new view.FocusEvent("focus"));
      assert.isTrue(wrapper.classList.contains("is-focused"));
      await settle();
      assert.equal(win.getComputedStyle(effect).opacity, "1");
      assert.equal(win.getComputedStyle(effect).animationName, "none");
      assert.equal(
        win.getComputedStyle(glint).animationName,
        reduced ? "none" : "chat-composer-glint",
      );

      input.dispatchEvent(new view.FocusEvent("blur"));
      assert.isFalse(wrapper.classList.contains("is-focused"));
      await settle();
      assert.equal(win.getComputedStyle(effect).opacity, "0");
      await new Promise<void>((resolve) => win.setTimeout(resolve, 600));
      if (!reduced) assert.isFalse(effect.classList.contains("is-playing"));
    }
  });
});
