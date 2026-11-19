globalThis.connectStudyResource = getState => {
  const classroomOrigin = "https://mohw.elearn.hrd.gov.tw";
  const ancestors = location.ancestorOrigins;
  if (!ancestors?.length || ancestors[ancestors.length - 1] !== classroomOrigin) return;

  let port;
  let retry;
  let lastRequest = -Infinity;

  function announce() {
    if (performance.now() - lastRequest < 3000) return;
    port?.close();
    // A port belongs to this document, even if its iframe later navigates.
    const channel = new MessageChannel();
    port = channel.port1;
    port.onmessage = ({ data }) => {
      if (!Number.isSafeInteger(data?.request)) return;
      lastRequest = performance.now();
      channel.port1.postMessage({ request: data.request, ...getState(data) });
    };
    top.postMessage({ type: "e-study:resource-ready" }, classroomOrigin, [channel.port2]);
  }

  function start() {
    announce();
    retry = setInterval(announce, 1000);
  }

  addEventListener("pagehide", () => {
    clearInterval(retry);
    port?.close();
    port = null;
    lastRequest = -Infinity;
  });
  addEventListener("pageshow", event => { if (event.persisted) start(); });
  start();
};
