import { openApplicationTab } from './open-app';

chrome.action.onClicked.addListener(() => {
  void openApplicationTab();
});
