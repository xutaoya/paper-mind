type PanelTabs = Pick<_ZoteroTypes.Zotero_Tabs, "selectedID" | "getState">;

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
