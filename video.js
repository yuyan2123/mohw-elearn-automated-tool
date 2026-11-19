(() => {
  const courseOrigin = "https://mohw.elearn.hrd.gov.tw";
  if (window === top) return;
  let attemptedVideo = null;
  let failedVideo = null;
  let attemptedControl = null;

  addEventListener("message", event => {
    if (event.origin !== courseOrigin || !event.source
      || event.data?.type !== "e-study:video-query"
      || !Number.isSafeInteger(event.data.request)) return;

    const video = document.querySelector("#movie_player video.html5-main-video");
    const ad = document.querySelector("#movie_player.ad-showing, #movie_player.ad-interrupting");
    if (event.data.play === true && !ad && !video?.ended) {
      if (video?.paused && attemptedVideo !== video && (video.currentSrc || video.readyState)) {
        attemptedVideo = video;
        void video.play().catch(() => { failedVideo = video; });
      } else if (!video || (video.paused && !video.currentSrc && !video.readyState)) {
        const button = document.querySelector("#movie_player .ytp-large-play-button");
        if (button && attemptedControl !== button && button.getClientRects().length) {
          attemptedControl = button;
          button.click();
        }
      }
    }
    let state = "waiting";
    if (ad) {
      state = "ad";
    } else if (video?.ended) {
      state = "ended";
    } else if (video && !video.paused && !video.seeking && video.readyState >= 3) {
      state = "playing";
    } else if (video?.paused) {
      state = failedVideo === video && event.data.play ? "blocked" : "paused";
    }

    event.source.postMessage({ type: "e-study:video-state", request: event.data.request, state }, courseOrigin);
  });
})();
