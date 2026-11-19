(() => {
  const courseOrigin = "https://mohw.elearn.hrd.gov.tw";
  if (window === top) return;

  addEventListener("message", event => {
    if (event.origin !== courseOrigin || !event.source
      || event.data?.type !== "e-study:video-query"
      || !Number.isSafeInteger(event.data.request)) return;

    const video = document.querySelector("#movie_player video.html5-main-video");
    let state = "waiting";
    if (document.querySelector("#movie_player.ad-showing, #movie_player.ad-interrupting")) {
      state = "ad";
    } else if (video?.ended) {
      state = "ended";
    } else if (video && !video.paused && !video.seeking && video.readyState >= 3) {
      state = "playing";
    } else if (video?.paused) {
      state = "paused";
    }

    event.source.postMessage({ type: "e-study:video-state", request: event.data.request, state }, courseOrigin);
  });
})();
