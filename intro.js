globalThis.showStudyIntro = panel => {
  const page = top.document;
  const frame = window.frameElement;
  if (!frame || page.getElementById("e-study-intro")) return;

  const layer = page.createElement("div");
  layer.id = "e-study-intro";
  const useTopLayer = typeof layer.showPopover === "function";
  if (useTopLayer) layer.setAttribute("popover", "manual");
  layer.innerHTML = `
    <div class="e-study-spotlight" aria-hidden="true"></div>
    <section class="e-study-tip" aria-label="學習助手提示">
      <p>在這裡查看剩餘時數，也能設定影片播完後自動接續。</p>
      <button type="button">知道了</button>
    </section>
  `;
  const spotlight = layer.querySelector(".e-study-spotlight");
  const tip = layer.querySelector(".e-study-tip");
  const dismiss = tip.querySelector("button");
  const previousFocus = page.activeElement;
  page.documentElement.append(layer);
  if (useTopLayer) layer.showPopover();

  const edge = 12;
  const gap = 32;
  const inset = 4;
  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

  function position() {
    const width = page.documentElement.clientWidth;
    const height = page.documentElement.clientHeight;
    const outer = frame.getBoundingClientRect();
    const inner = panel.getBoundingClientRect();
    const left = Math.max(0, outer.left, outer.left + inner.left - inset);
    const right = Math.min(width, outer.right, outer.left + inner.right + inset);
    const topEdge = Math.max(0, outer.top, outer.top + inner.top - inset);
    const bottom = Math.min(height, outer.bottom, outer.top + inner.bottom + inset);
    layer.style.visibility = right > left && bottom > topEdge ? "visible" : "hidden";
    if (layer.style.visibility === "hidden") return;

    Object.assign(spotlight.style, {
      left: `${left}px`, top: `${topEdge}px`,
      width: `${right - left}px`, height: `${bottom - topEdge}px`
    });

    const availableRight = width - right - gap - edge;
    const beside = availableRight >= 200;
    const tipWidth = Math.min(300, beside ? availableRight : width - 2 * edge);
    tip.style.width = `${tipWidth}px`;
    const tipHeight = tip.offsetHeight;
    const centerX = (left + right) / 2;
    const centerY = (topEdge + bottom) / 2;

    if (beside) {
      const y = clamp(centerY - tipHeight / 2, edge, height - edge - tipHeight);
      tip.dataset.arrow = "left";
      tip.style.left = `${right + gap}px`;
      tip.style.top = `${y}px`;
      tip.style.setProperty("--es-tip-arrow-offset", `${clamp(centerY - y, 16, tipHeight - 16)}px`);
    } else {
      const below = height - bottom >= tipHeight + gap + edge || height - bottom > topEdge;
      const x = clamp(centerX - tipWidth / 2, edge, width - edge - tipWidth);
      const y = clamp(below ? bottom + gap : topEdge - gap - tipHeight, edge, height - edge - tipHeight);
      tip.dataset.arrow = below ? "up" : "down";
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
      tip.style.setProperty("--es-tip-arrow-offset", `${clamp(centerX - x, 16, tipWidth - 16)}px`);
    }
  }

  function close(restoreFocus = false) {
    observer.disconnect();
    top.removeEventListener("resize", position);
    top.removeEventListener("keydown", onKey, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", position, true);
    window.removeEventListener("pagehide", onPageHide);
    panel.removeEventListener("click", onPanelClick);
    layer.remove();
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }

  function onKey(event) {
    if (event.key !== "Escape" || layer.style.visibility === "hidden") return;
    event.preventDefault();
    close(page.activeElement === dismiss);
  }

  function onPanelClick(event) {
    if (event.isTrusted && event.target.closest("button, input, label")) close();
  }

  function onPageHide() { close(); }

  const observer = new ResizeObserver(position);
  observer.observe(panel);
  observer.observe(frame);
  top.addEventListener("resize", position);
  window.addEventListener("scroll", position, true);
  top.addEventListener("keydown", onKey, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("pagehide", onPageHide, { once: true });
  panel.addEventListener("click", onPanelClick);
  dismiss.addEventListener("click", () => close(true));
  position();
  if (page.hasFocus() && layer.style.visibility === "visible") dismiss.focus({ preventScroll: true });
};
