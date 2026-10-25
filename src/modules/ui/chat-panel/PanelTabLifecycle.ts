import type { ChatSession } from "../../../types/chat";

type PanelTabs = Pick<_ZoteroTypes.Zotero_Tabs, "selectedID" | "getState">;

/** Select the conversation before publishing its composer context. */
export async function activatePanelTabSession(
  manager: {
    activateSessionForItem(item: Zotero.Item): Promise<ChatSession>;
    activateLibrarySession(): Promise<ChatSession>;
    getActiveSession(): ChatSession | null;
  },
  item: Zotero.Item | null,
  tabID: string | undefined,
  previousTabID: string | undefined,
  forceLibrary: boolean,
  preserveSession = false,
): Promise<ChatSession | null> {
  if (item) return manager.activateSessionForItem(item);
  if (preserveSession) return manager.getActiveSession();
  const switchedToLibrary =
    tabID === "zotero-pane" &&
    previousTabID !== undefined &&
    previousTabID !== tabID;
  if (forceLibrary || switchedToLibrary)
    return manager.activateLibrarySession();
  return manager.getActiveSession();
}

export function createPanelTabObserver(
  getTabs: () => PanelTabs | undefined,
  onLastReaderClosed: () => void,
  onTabChanged: () => void,
): { notify: (event: string) => void } {
  const hasReaders = (tabs: PanelTabs | undefined) =>
    tabs
      ?.getState()
      .some((tab) => tab.type === "reader" || tab.type.startsWith("reader-")) ??
    false;
  let hadReaderTabs = hasReaders(getTabs());

  return {
    notify(event) {
      const tabs = getTabs();
      if (!tabs) return;
      const hasReaderTabs = hasReaders(tabs);
      const lastReaderClosed =
        event === "close" &&
        hadReaderTabs &&
        !hasReaderTabs &&
        tabs.selectedID === "zotero-pane";

      // Zotero selects the next tab before removing the closing tab. Its async
      // observers may see that selection after removal; retain history until close.
      hadReaderTabs =
        event === "close" ? hasReaderTabs : hadReaderTabs || hasReaderTabs;
      if (lastReaderClosed) {
        onLastReaderClosed();
      } else {
        onTabChanged();
      }
    },
  };
}
