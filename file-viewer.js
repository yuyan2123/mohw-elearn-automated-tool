(() => {
  const classroomOrigin = "https://mohw.elearn.hrd.gov.tw";
  const asset = location.pathname.match(/^\/asset\/play\/(\d+)\/?$/);
  if (window === top || !asset) return;

  const filePath = `/asset/play/${asset[1]}/file`;
  const displayedFile = /^(?:application\/pdf|image\/[\w.+-]+|text\/plain)(?:\s*;|$)/i;

  function fileIsReady() {
    const frame = document.querySelector("#view-container iframe[src]");
    const bounds = frame?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return false;
    const source = new URL(frame.src);
    if (source.origin !== location.origin || source.pathname !== filePath) return false;
    source.hash = "";

    const response = performance.getEntriesByName(source.href, "resource")
      .findLast(entry => entry.initiatorType === "iframe");
    if (response?.responseStatus >= 400) return false;

    const file = frame.contentDocument;
    if (file && file.URL !== "about:blank") {
      if (file.readyState !== "complete") return false;
      const loaded = new URL(file.URL);
      if (loaded.origin !== source.origin || loaded.pathname !== source.pathname) return false;
      if (displayedFile.test(file.contentType)) return true;
      if (file.querySelector('embed[type="application/pdf"], object[type="application/pdf"]')) return true;
      return false;
    }

    // Chrome may keep the built-in PDF document out of reach of its embedding page.
    return Boolean(response?.responseEnd && displayedFile.test(response.contentType)
      && ((response.responseStatus >= 200 && response.responseStatus < 300) || response.responseStatus === 304));
  }

  addEventListener("message", event => {
    if (event.origin !== classroomOrigin || !event.source
      || event.data?.type !== "e-study:file-query"
      || !Number.isSafeInteger(event.data.request)) return;

    event.source.postMessage({
      type: "e-study:file-state", request: event.data.request, ready: fileIsReady()
    }, classroomOrigin);
  });
})();
