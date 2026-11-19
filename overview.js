(() => {
  const title = Study.title(document.title);
  if (!title) return;

  function entrance() {
    return [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"]')]
      .find(element => (element.tagName === "INPUT" ? element.value : element.textContent).trim() === "上課去"
        && !element.disabled && element.getClientRects().length);
  }

  async function readOverview() {
    const { credited, target } = Study.summary(document.body.innerText, document.body.textContent);
    const ready = await chrome.runtime.sendMessage({ type: "overview:read", title, credited, target });
    if (!ready || document.hidden || !document.hasFocus()) return;
    const enter = entrance();
    if (!enter) return;
    const resume = await chrome.runtime.sendMessage({ type: "overview:continue", title });
    if (resume && !document.hidden && document.hasFocus() && enter.isConnected) enter.click();
  }

  void readOverview().catch(() => {});
})();
