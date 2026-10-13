import { browser } from "wxt/browser";

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: "save-link",
      title: "Save link to Sourcefold",
      contexts: ["link"],
    });
  });

  browser.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === "save-link") {
      // TODO(wave 7): Handle saving link from context menu
      console.log("Save link to Sourcefold clicked:", info.linkUrl);
    }
  });
});
