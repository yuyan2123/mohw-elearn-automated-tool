(() => {
  let attemptedVideo = null;
  let failedVideo = null;
  let attemptedControl = null;

  connectStudyResource(({ play }) => {
    const video = document.querySelector("#movie_player video.html5-main-video");
    const ad = document.querySelector("#movie_player.ad-showing, #movie_player.ad-interrupting");
    if (play === true && !ad && !video?.ended) {
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
      state = failedVideo === video && play ? "blocked" : "paused";
    }

    return { state };
  });
})();
