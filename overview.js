(() => {
  let capturing = false;
  let recapture = false;
  let saved = "";
  let canContinue = false;
  let reserved = false;
  let entering = false;

  function entrance() {
    return [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"]')]
      .find(element => (element.tagName === "INPUT" ? element.value : element.textContent).trim() === "上課去"
        && !element.disabled && element.getClientRects().length);
  }

  async function readOverview() {
    if (entering) return;
    if (capturing) {
      recapture = true;
      return;
    }
    const title = Study.title(document.title);
    const { credited, target } = Study.summary(document.body.innerText, document.body.textContent);
    if (!title) return;

    capturing = true;
    try {
      const signature = JSON.stringify([title, credited, target]);
      if (signature !== saved) {
        canContinue = await chrome.runtime.sendMessage({ type: "overview:read", title, credited, target });
        saved = signature;
      }
      if (credited == null || !target || !(canContinue || reserved) || document.hidden || !document.hasFocus()) return;
      const enter = entrance();
      if (!enter) return;
      if (!reserved) {
        reserved = await chrome.runtime.sendMessage({ type: "overview:continue", title });
        canContinue = false;
      }
      if (reserved && !document.hidden && document.hasFocus() && enter.isConnected) {
        entering = true;
        enter.click();
      }
    } finally {
      capturing = false;
      if (recapture) {
        recapture = false;
        capture();
      }
    }
  }

  function capture() { void readOverview().catch(() => {}); }
  const observer = new MutationObserver(capture);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  document.addEventListener("visibilitychange", capture);
  addEventListener("focus", capture);
  addEventListener("pageshow", event => {
    if (event.persisted) {
      entering = false;
      reserved = false;
      saved = "";
    }
    capture();
  });
  capture();
})();
