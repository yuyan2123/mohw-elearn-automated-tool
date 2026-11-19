(() => {
  const sidebar = document.querySelector("#moocSidebar");
  if (!sidebar || window === top || top.location.origin !== location.origin
    || !top.location.pathname.startsWith("/learn/")) return;

  let title = "";
  const youtube = "https://www.youtube.com";
  const lcms = "https://lcms.elearn.hrd.gov.tw";
  const environmentNode = "I_SCO_99999999_9999999999999999";
  const panel = document.createElement("section");
  panel.id = "e-study-panel";
  panel.setAttribute("aria-labelledby", "e-study-title");
  panel.innerHTML = `
    <h2 id="e-study-title">學習助手</h2>
    <dl>
      <div><dt>已入帳</dt><dd id="e-study-credited">讀取中</dd></div>
      <div><dt>閱讀門檻</dt><dd id="e-study-target">讀取中</dd></div>
      <div><dt>距門檻</dt><dd id="e-study-remaining">—</dd></div>
      <div><dt>本段估算</dt><dd id="e-study-local">00:00:00</dd></div>
    </dl>
    <p id="e-study-status" role="status">正在讀取課程</p>
    <p id="e-study-file-plan" hidden></p>
    <button type="button" id="e-study-sync" hidden>讀取平臺時數</button>
    <button type="button" id="e-study-start" data-primary disabled>開始學習</button>
    <button type="button" id="e-study-next" data-primary hidden>結算並看下一篇</button>
    <button type="button" id="e-study-settle" hidden>結算並查看時數</button>
    <label><input type="checkbox" id="e-study-auto" checked disabled>影片播完自動結算並接續</label>
  `;
  sidebar.append(panel);

  const get = name => panel.querySelector(`#e-study-${name}`);
  const controls = {
    credited: get("credited"), target: get("target"), remaining: get("remaining"),
    local: get("local"), status: get("status"),
    filePlan: get("file-plan"), sync: get("sync"),
    start: get("start"), next: get("next"), settle: get("settle"), auto: get("auto")
  };

  let official = null;
  let resume = null;
  let showIntro = true;
  let ready = false;
  let settling = false;
  let syncing = false;
  let needsSync = true;
  let autoNextEnabled = true;
  let verifyFiles = false;
  let fileCheckIssued = false;
  let autoplayLesson = null;
  let attemptedVideo = null;
  let failure = "";
  let totals = 0;
  let lastSample = null;
  let snapshot = null;
  let videoState = "waiting";
  let fileReady = false;
  let resource = null;
  let resourceRequest = 0;
  let receivedAt = 0;
  let playbackSeen = false;

  function inForeground() {
    return !top.document.hidden && top.document.hasFocus();
  }

  function courseTree() {
    return top.document.querySelector("#s_catalog")?.contentDocument
      ?.querySelector("#pathtree")?.contentDocument;
  }

  function courseId() {
    for (const script of courseTree()?.querySelectorAll("script:not([src])") ?? []) {
      const id = script.textContent.match(/\bvar\s+cid\s*=\s*['"]?(\d+)\b/)?.[1];
      if (id) return id;
    }
    return null;
  }

  function openClassroom() {
    const header = top.document.querySelector("#s_sysbar")?.contentDocument;
    const courseName = header?.querySelector(".coursename")?.textContent.trim();
    const pageTitle = top.document.title;
    if (!courseName && !/\s*[-–—]\s*衛生福利e學園$/.test(pageTitle)) return;
    title = Study.title(courseName || pageTitle);
    if (!title) return;

    void chrome.runtime.sendMessage({ type: "classroom:open", title }).then(result => {
      official = result?.summary ?? null;
      resume = result?.resume ?? null;
      if (resume) {
        showIntro = false;
        autoNextEnabled = resume.autoNext === true;
        verifyFiles = resume.verifyFiles === true;
        controls.auto.checked = autoNextEnabled;
      }
    }).catch(() => {
      failure = "讀不到已入帳時數，可用平臺的課程資訊頁確認";
    }).finally(() => {
      ready = true;
      stimulate();
    });
  }

  async function syncOfficial() {
    if (syncing || settling) return;
    syncing = true;
    needsSync = false;
    failure = "";
    render();
    try {
      const result = await chrome.runtime.sendMessage({
        type: "classroom:sync", title, courseId: courseId(), referrer: top.document.referrer
      });
      if (result?.summary) official = result.summary;
      else if (result?.missingPage) failure = "找不到對應的課程資訊頁，請從課程資訊頁進入";
      else failure = "背景讀取未完成，可再試一次";
    } catch {
      failure = "背景讀取未完成，可再試一次";
    } finally {
      syncing = false;
      stimulate();
    }
  }

  function inspectMaterial(doc, depth = 0) {
    if (!doc || depth > 5 || doc.readyState === "loading") return {};
    const video = doc.querySelector("video");
    if (video) return { video };
    for (const frame of doc.querySelectorAll("iframe, frame")) {
      const src = new URL(frame.src || "about:blank", doc.URL);
      if (src.origin === youtube && src.pathname.startsWith("/embed/")) return { frame };
      if (src.origin === lcms && /^\/asset\/play\/\d+\/?$/.test(src.pathname)) return { fileFrame: frame };
      const nested = inspectMaterial(frame.contentDocument, depth + 1);
      if (nested.video || nested.frame || nested.fileFrame || nested.readable) return nested;
      if (/\.pdf$/i.test(src.pathname)) return { readable: true };
    }
    const isMaterial = doc.location?.protocol === "https:" && doc.body
      && !/\/(?:chk_client_env|SCORM_fetchResource)\.php$/i.test(doc.location.pathname);
    return { readable: Boolean(isMaterial
      && (doc.body.innerText?.trim() || doc.querySelector("img, embed, object, canvas"))) };
  }

  function collect() {
    const menu = document.querySelector("#SYS_04_01_002");
    const active = Boolean(menu?.closest("li")?.classList.contains("active")
      || menu?.parentElement?.classList.contains("active"));
    const tree = courseTree();
    const lessons = Array.from(tree?.querySelectorAll("li[id^='I_SCO_']") ?? [])
      .filter(node => node.id !== environmentNode && node.querySelector("a"));
    const selected = tree?.querySelector("li.selected[id^='I_SCO_']")?.id ?? null;
    const index = lessons.findIndex(node => node.id === selected);
    const mainFrame = top.document.querySelector("#s_main");
    const bounds = mainFrame?.getBoundingClientRect();
    const present = Boolean(bounds?.width && bounds.height);
    const main = mainFrame?.contentDocument;
    return {
      lessons, selected, index, active, main, present, treeReady: tree?.readyState === "complete",
      next: index >= 0 ? lessons[index + 1] : null,
      ...inspectMaterial(main)
    };
  }

  function reached() {
    return remaining() === 0;
  }

  function remaining() {
    return official ? Math.max(0, official.target - official.credited) : null;
  }

  function render() {
    const current = snapshot;
    const timeLeft = remaining();
    const loading = syncing || !ready ? "讀取中" : "未取得";
    controls.credited.textContent = official ? Study.format(official.credited) : loading;
    controls.target.textContent = official ? Study.format(official.target) : loading;
    controls.remaining.textContent = Study.format(timeLeft);
    controls.local.textContent = Study.format(totals / 1000);
    const media = current?.frame || current?.video;
    const file = current?.fileFrame || current?.readable;
    const canStartCurrent = media ? ["waiting", "paused"].includes(videoState) && autoplayLesson !== current.selected
      : file && !verifyFiles && !fileCheckIssued;
    controls.start.hidden = !current?.active || (current.index >= 0 && !canStartCurrent);
    controls.start.disabled = !current?.lessons.length || !ready || settling || !official || reached();
    controls.sync.hidden = !ready || !current?.active || Boolean(official);
    controls.sync.disabled = settling || syncing;
    controls.next.hidden = !current?.active || current.index < 0 || !current.next;
    controls.next.disabled = !ready || settling;
    controls.settle.hidden = !current?.active || current.index < 0;
    controls.settle.disabled = !ready || settling;
    controls.auto.disabled = !ready || settling || reached();

    const reading = current?.active && current.index >= 0 && (current.readable || (current.fileFrame && fileReady));
    controls.filePlan.hidden = !reading;
    if (reading) {
      controls.filePlan.textContent = verifyFiles && !fileCheckIssued && timeLeft > 0
        ? `距本段結算約 ${Study.format(Math.ceil(timeLeft - totals / 1000))}`
        : "檔案依前景閱讀時間估算";
    }
    const status = failure || (syncing ? "正在讀取平臺時數" : settling ? "正在透過平臺結算"
      : reached() ? "已達閱讀門檻" : !official && ready ? "請先讀取平臺時數"
      : !current?.active ? "請切到「開始上課」"
      : current.index < 0 ? "按「開始學習」開啟教材"
      : !current.present ? "請查看課程畫面的提示"
      : videoState === "ended" ? "影片已播完"
      : videoState === "playing" ? "影片播放中"
      : videoState === "blocked" ? "Chrome 需要你在播放器按一次播放"
      : videoState === "paused" ? (autoplayLesson === current.selected ? "正在開始播放" : "影片已暫停")
      : videoState === "ad" ? "正在播放廣告"
      : current.frame || current.video ? "正在等候播放器"
      : current.fileFrame ? (fileReady ? "檔案閱讀中" : "正在載入檔案")
      : current.readable ? "教材閱讀中" : "正在載入教材");
    if (controls.status.textContent !== status) controls.status.textContent = status;
  }

  async function leaveCourse({ next = null, checkpoint = false } = {}) {
    if (settling || !snapshot?.active || snapshot.index < 0 || !inForeground()) return;
    const selected = snapshot.selected;
    const leave = top.document.querySelector("#s_sysbar")?.contentDocument
      ?.querySelector("#leaveBtn");
    if (!leave) {
      failure = "找不到平臺的離開課程按鈕";
      return render();
    }
    settling = true;
    failure = "";
    render();
    let saved = false;
    try {
      if (next && !reached()) {
        const message = { type: "classroom:plan", title, lesson: next.id, autoNext: autoNextEnabled, verifyFiles,
          checkpoint: checkpoint ? official.credited : null };
        saved = await chrome.runtime.sendMessage(message);
        if (!saved) throw new Error("Could not save the continuation");
      }
      const latest = collect();
      if (!inForeground() || !leave.isConnected || !latest.active || latest.selected !== selected) {
        throw new Error("The page is no longer active");
      }
      leave.click();
      setTimeout(() => {
        settling = false;
        render();
      }, 3000);
    } catch {
      if (saved) void chrome.runtime.sendMessage({ type: "classroom:cancel", title }).catch(() => {});
      settling = false;
      failure = "接續準備未完成，請再試一次";
      render();
    }
  }

  function applyVideoState(state) {
    if (state === "ad") playbackSeen = false;
    if (state === "playing" && snapshot?.present && inForeground()) playbackSeen = true;
    if (state === "playing") autoplayLesson = null;
    const justEnded = state === "ended" && videoState !== "ended" && playbackSeen;
    videoState = state;
    if (justEnded && ready && autoNextEnabled && !reached() && inForeground()) {
      const current = collect();
      if (current.active && current.present && current.selected === snapshot?.selected
        && current.main === snapshot?.main) {
        void leaveCourse({ next: current.next });
      }
    }
  }

  function closeResource() {
    resource?.port.close();
    resource = null;
  }

  function onResourceReady(event) {
    if (event.data?.type !== "e-study:resource-ready" || !event.ports.length) return;
    const [port] = event.ports;
    const video = event.origin === youtube;
    const frame = video ? snapshot?.frame : event.origin === lcms ? snapshot?.fileFrame : null;
    if (!frame?.isConnected || frame.contentWindow !== event.source) {
      port.close();
      return;
    }

    closeResource();
    const connection = { frame, port };
    resource = connection;
    port.onmessage = ({ data }) => {
      if (resource !== connection || data?.request !== resourceRequest || !frame.isConnected) return;
      if (video && ["waiting", "paused", "playing", "ended", "ad", "blocked"].includes(data.state)) {
        receivedAt = performance.now();
        applyVideoState(data.state);
      } else if (!video && typeof data.ready === "boolean") {
        receivedAt = performance.now();
        fileReady = data.ready;
      }
    };
  }

  function stimulate() {
    const next = collect();
    if (resource && resource.frame !== (next.frame || next.fileFrame)) closeResource();
    if (snapshot && next.selected !== snapshot.selected) {
      totals = 0;
      fileCheckIssued = false;
    }
    if (!snapshot || next.selected !== snapshot.selected || next.main !== snapshot.main
      || next.frame !== snapshot.frame || next.video !== snapshot.video
      || next.fileFrame !== snapshot.fileFrame) {
      lastSample = null;
      receivedAt = 0;
      resourceRequest++;
      fileReady = false;
      videoState = "waiting";
      playbackSeen = false;
      attemptedVideo = null;
    }
    snapshot = next;

    if (!title && next.treeReady && next.lessons.length) openClassroom();
    if (ready && !official && needsSync && next.active && next.treeReady && next.lessons.length) {
      void syncOfficial();
    }

    if (resume && next.active && next.lessons.length) {
      const anchor = next.lessons.find(node => node.id === resume.lesson)?.querySelector("a");
      const canResume = inForeground() && anchor && !reached() && next.index < 0;
      resume = null;
      if (canResume) {
        autoplayLesson = anchor.closest("li").id;
        anchor.click();
        return stimulate();
      }
    }

    if (next.active && next.index >= 0) {
      const play = autoplayLesson === next.selected && next.present && inForeground();
      if (next.frame || next.fileFrame) {
        if (performance.now() - receivedAt > 2500) {
          if (next.frame && videoState !== "ended") applyVideoState("waiting");
          fileReady = false;
        }
        resource?.port.postMessage({ request: ++resourceRequest, play });
      } else if (next.video) {
        const { ended, paused, seeking, readyState } = next.video;
        if (play && !ended && paused && attemptedVideo !== next.video) {
          const video = next.video;
          attemptedVideo = video;
          void video.play().catch(() => {
            if (snapshot?.video === video) applyVideoState("blocked");
          });
        }
        const pausedState = play && videoState === "blocked" ? "blocked" : "paused";
        applyVideoState(ended ? "ended" : paused ? pausedState : !seeking && readyState >= 3 ? "playing" : "waiting");
      }
    }

    const now = performance.now();
    const materialReady = next.frame || next.video ? videoState === "playing" : next.readable || fileReady;
    const studying = next.active && next.present && next.index >= 0 && !settling && inForeground() && materialReady;
    if (studying && lastSample != null && now - lastSample <= 1600) totals += now - lastSample;
    lastSample = studying ? now : null;
    const timeLeft = remaining();
    if (studying && !(next.frame || next.video) && verifyFiles && !fileCheckIssued
      && timeLeft > 0 && totals >= timeLeft * 1000) {
      fileCheckIssued = true;
      void leaveCourse({ next: next.lessons[next.index], checkpoint: true });
    }
    render();
    if (showIntro && ready && official && next.active && next.lessons.length) {
      showIntro = false;
      showStudyIntro(panel);
    }
  }

  controls.start.addEventListener("click", event => {
    if (!event.isTrusted || !inForeground() || !snapshot?.lessons.length) return;
    verifyFiles = true;
    const lesson = snapshot.lessons[snapshot.index >= 0 ? snapshot.index : 0];
    autoplayLesson = lesson.id;
    if (snapshot.index < 0) lesson.querySelector("a").click();
    stimulate();
  });
  controls.sync.addEventListener("click", event => {
    if (event.isTrusted) void syncOfficial();
  });
  controls.next.addEventListener("click", event => {
    if (event.isTrusted) void leaveCourse({ next: collect().next });
  });
  controls.settle.addEventListener("click", event => {
    if (event.isTrusted) void leaveCourse();
  });
  controls.auto.addEventListener("change", event => {
    if (event.isTrusted) autoNextEnabled = controls.auto.checked;
  });

  top.addEventListener("message", onResourceReady);
  function resetSample() {
    lastSample = null;
    if (!inForeground()) playbackSeen = false;
  }
  top.document.addEventListener("visibilitychange", resetSample);
  top.addEventListener("blur", resetSample);
  const refresh = setInterval(stimulate, 750);
  addEventListener("pagehide", () => {
    clearInterval(refresh);
    top.removeEventListener("message", onResourceReady);
    closeResource();
    top.removeEventListener("blur", resetSample);
    top.document.removeEventListener("visibilitychange", resetSample);
  }, { once: true });

  stimulate();
})();
