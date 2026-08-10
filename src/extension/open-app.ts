export async function openApplicationTab(): Promise<void> {
  await chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
}
