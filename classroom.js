(() => {
  const sidebar = document.querySelector("#moocSidebar");
  if (!sidebar || window === top || top.location.origin !== location.origin
    || !top.location.pathname.startsWith("/learn/")) return;

  const title = Study.title(top.document.title);
  const youtube = "https://www.youtube.com";
  const lcms = "https://lcms.elearn.hrd.gov.tw";
  const environmentNode = "I_SCO_99999999_9999999999999999";
  const panel = document.createElement("section");
  panel.id = "e-study-panel";
  panel.setAttribute("aria-labelledby", "e-study-title");
  panel.innerHTML = `
    <h2 id="e-study-title">學習助手</h2>
    <dl>
      <div><dt>已入帳</dt><dd id="e-study-credited">—</dd></div>
      <div><dt>閱讀門檻</dt><dd id="e-study-target">—</dd></div>
      <div><dt>距門檻</dt><dd id="e-study-remaining">—</dd></div>
      <div><dt>本段估算</dt><dd id="e-study-local">00:00:00</dd></div>
    </dl>
    <p id="e-study-status" role="status">正在讀取課程</p>
    <button type="button" id="e-study-start" data-primary disabled>開啟第一篇教材</button>
    <button type="button" id="e-study-next" data-primary hidden>結算並看下一篇</button>
    <button type="button" id="e-study-settle" hidden>結算並查看時數</button>
    <label><input type="checkbox" id="e-study-auto" checked disabled>影片播完自動結算並接續</label>
  `;
  sidebar.append(panel);

  const get = name => panel.querySelector(`#e-study-${name}`);
  const controls = {
    credited: get("credited"), target: get("target"), remaining: get("remaining"),
    local: get("local"), status: get("status"),
    start: get("start"), next: get("next"), settle: get("settle"), auto: get("auto")
  };

  let official = null;
  let resume = null;
  let showIntro = true;
  let ready = false;
  let settling = false;
  let autoNextEnabled = true;
  let failure = "";
  let totals = 0;
  let lastSample = null;
  let snapshot = null;
  let videoState = "waiting";
  let fileReady = false;
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
      lessons, selected, index, active, main, present,
      next: index >= 0 ? lessons[index + 1] : null,
      ...inspectMaterial(main)
    };
  }

  function reached() {
    return official?.credited != null && official.target != null
      && official.credited >= official.target;
  }

  function render() {
    const current = snapshot;
    controls.credited.textContent = Study.format(official?.credited);
    controls.target.textContent = Study.format(official?.target);
    controls.remaining.textContent = Study.format(official?.target != null && official?.credited != null
      ? official.target - official.credited
      : null);
    controls.local.textContent = Study.format(totals / 1000);
    controls.start.hidden = !current?.active || current.index >= 0;
    controls.start.disabled = !current?.lessons.length || !ready || settling;
    controls.next.hidden = !current?.active || current.index < 0 || !current.next;
    controls.next.disabled = !ready || settling;
    controls.settle.hidden = !current?.active || current.index < 0;
    controls.settle.disabled = !ready || settling;
    controls.auto.disabled = !ready || settling || reached();

    const status = failure || (settling ? "正在透過平臺結算" : reached() ? "已達閱讀門檻"
      : !current?.active ? "請切到「開始上課」"
      : current.index < 0 ? "請選擇一篇教材"
      : !current.present ? "請查看課程畫面的提示"
      : videoState === "ended" ? "影片已播完"
      : videoState === "playing" ? "影片播放中"
      : videoState === "paused" ? "請在播放器按播放"
      : videoState === "ad" ? "正在播放廣告"
      : current.frame || current.video ? "正在等候播放器"
      : current.fileFrame ? (fileReady ? "檔案閱讀中" : "正在載入檔案")
      : current.readable ? "教材閱讀中" : "正在載入教材");
    if (controls.status.textContent !== status) controls.status.textContent = status;
  }

  async function settle(next, autoNext = false) {
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
        saved = await chrome.runtime.sendMessage({
          type: "classroom:plan", title, lesson: next.id, autoNext
        });
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
    const justEnded = state === "ended" && videoState !== "ended" && playbackSeen;
    videoState = state;
    if (justEnded && ready && autoNextEnabled && !reached() && inForeground()) {
      const current = collect();
      if (current.active && current.present && current.selected === snapshot?.selected
        && current.main === snapshot?.main) {
        void settle(current.next, true);
      }
    }
  }

  function onResourceMessage(event) {
    if (event.data?.request !== resourceRequest) return;
    if (event.origin === lcms && snapshot?.fileFrame
      && event.source === snapshot.fileFrame.contentWindow
      && event.data.type === "e-study:file-state" && typeof event.data.ready === "boolean") {
      receivedAt = performance.now();
      fileReady = event.data.ready;
      return;
    }
    if (event.origin !== youtube || !snapshot?.frame
      || event.source !== snapshot.frame.contentWindow || event.data?.type !== "e-study:video-state"
      || !["waiting", "paused", "playing", "ended", "ad"].includes(event.data.state)) return;
    receivedAt = performance.now();
    applyVideoState(event.data.state);
  }

  function stimulate() {
    const next = collect();
    if (!snapshot || next.selected !== snapshot.selected || next.main !== snapshot.main
      || next.frame !== snapshot.frame || next.video !== snapshot.video
      || next.fileFrame !== snapshot.fileFrame) {
      lastSample = null;
      receivedAt = 0;
      resourceRequest++;
      fileReady = false;
      videoState = "waiting";
      playbackSeen = false;
    }
    snapshot = next;

    if (resume && next.active && next.lessons.length) {
      const anchor = next.lessons.find(node => node.id === resume.lesson)?.querySelector("a");
      const canResume = inForeground() && anchor && !reached() && next.index < 0;
      resume = null;
      if (canResume) {
        anchor.click();
        return stimulate();
      }
    }

    if (next.active && next.index >= 0) {
      if (next.frame) {
        if (performance.now() - receivedAt > 2500 && videoState !== "ended") applyVideoState("waiting");
        next.frame.contentWindow?.postMessage({ type: "e-study:video-query", request: ++resourceRequest }, youtube);
      } else if (next.fileFrame) {
        if (performance.now() - receivedAt > 2500) fileReady = false;
        next.fileFrame.contentWindow?.postMessage({ type: "e-study:file-query", request: ++resourceRequest }, lcms);
      } else if (next.video) {
        const { ended, paused, seeking, readyState } = next.video;
        applyVideoState(ended ? "ended" : paused ? "paused" : !seeking && readyState >= 3 ? "playing" : "waiting");
      }
    }

    const now = performance.now();
    const materialReady = next.frame || next.video ? videoState === "playing" : next.readable || fileReady;
    const studying = next.active && next.present && next.index >= 0 && !settling && inForeground() && materialReady;
    if (studying && lastSample != null && now - lastSample <= 1600) totals += now - lastSample;
    lastSample = studying ? now : null;
    render();
    if (showIntro && ready && next.active && next.lessons.length) {
      showIntro = false;
      showStudyIntro(panel);
    }
  }

  controls.start.addEventListener("click", event => {
    if (event.isTrusted && inForeground()) snapshot?.lessons[0]?.querySelector("a")?.click();
  });
  controls.next.addEventListener("click", event => {
    if (event.isTrusted) void settle(collect().next, autoNextEnabled);
  });
  controls.settle.addEventListener("click", event => {
    if (event.isTrusted) void settle(null);
  });
  controls.auto.addEventListener("change", event => {
    if (event.isTrusted) autoNextEnabled = controls.auto.checked;
  });

  addEventListener("message", onResourceMessage);
  function resetSample() {
    lastSample = null;
    if (!inForeground()) playbackSeen = false;
  }
  top.document.addEventListener("visibilitychange", resetSample);
  top.addEventListener("blur", resetSample);
  const refresh = setInterval(stimulate, 750);
  addEventListener("pagehide", () => {
    clearInterval(refresh);
    removeEventListener("message", onResourceMessage);
    top.removeEventListener("blur", resetSample);
    top.document.removeEventListener("visibilitychange", resetSample);
  }, { once: true });

  void chrome.runtime.sendMessage({ type: "classroom:open", title }).then(result => {
    official = result?.summary ?? null;
    resume = result?.resume ?? null;
    if (resume) {
      showIntro = false;
      autoNextEnabled = resume.autoNext === true;
      controls.auto.checked = autoNextEnabled;
    }
  }).catch(() => {
    failure = "讀不到已入帳時數，可用平臺的課程資訊頁確認";
  }).finally(() => {
    ready = true;
    stimulate();
  });
})();
