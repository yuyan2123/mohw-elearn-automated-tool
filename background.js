const overviewHosts = new Set(["elearn.hrd.gov.tw", "mohw.elearn.hrd.gov.tw"]);
const resumeLifetime = 120_000;
const queues = new Map();
const summaryTabs = new Map();
const validTime = value => Number.isSafeInteger(value) && value >= 0;
// This class uses a different ID in the public course catalog.
const knownOverview = new Map([["10005931", {
  title: "民眾版CPR+AED教學影片",
  url: "https://elearn.hrd.gov.tw/info/10043406"
}]]);

function overviewPage(input) {
  if (!input) return null;
  try {
    const url = new URL(input);
    if (url.protocol === "https:" && overviewHosts.has(url.host) && /^\/info\/\d+\/?$/.test(url.pathname)) {
      return url.origin + url.pathname.replace(/\/$/, "");
    }
  } catch {
    return null;
  }
  return null;
}

function readSummary({ title, credited, target }) {
  if (typeof title !== "string" || !title || !validTime(credited) || !validTime(target) || target === 0) return null;
  return { title, credited, target, updated: Date.now() };
}

async function readInBackground(url, title, windowId) {
  const tab = await chrome.tabs.create({ url: "about:blank", active: false, windowId });
  if (tab.id == null) return null;
  let timeout;
  try {
    const result = new Promise(resolve => {
      summaryTabs.set(tab.id, { title, url, resolve });
      timeout = setTimeout(() => resolve(null), 10_000);
    });
    await chrome.tabs.update(tab.id, { url });
    return await result;
  } finally {
    clearTimeout(timeout);
    summaryTabs.delete(tab.id);
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (typeof message?.type !== "string" || !sender.url || sender.tab?.id == null) return;
  const url = new URL(sender.url);
  if (url.protocol !== "https:") return;
  const overview = sender.frameId === 0 && overviewPage(url);
  const classroom = sender.frameId > 0 && url.hostname === "mohw.elearn.hrd.gov.tw"
    && url.pathname === "/learn/mooc_sysbar.php";
  if (
    !(overview && message.type.startsWith("overview:")) &&
    !(classroom && message.type.startsWith("classroom:"))
  ) return;

  const tabId = sender.tab.id;
  const lookup = summaryTabs.get(tabId);
  if (lookup) {
    if (overview === lookup.url && message.type === "overview:read" && message.title === lookup.title) {
      const summary = readSummary(message);
      if (summary) lookup.resolve(summary);
    }
    respond(false);
    return;
  }

  const key = `course-${tabId}`;
  const previous = queues.get(key) ?? Promise.resolve();
  const work = previous.then(() => update(key, message, overview, sender.tab.windowId));
  const queued = work.catch(() => {});
  queues.set(key, queued);
  work.then(respond, () => respond(null)).finally(() => {
    if (queues.get(key) === queued) queues.delete(key);
  });
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  summaryTabs.get(tabId)?.resolve(null);
  const key = `course-${tabId}`;
  const pending = queues.get(key) ?? Promise.resolve();
  void pending.then(() => chrome.storage.session.remove(key)).catch(() => {});
});

async function update(key, message, overview, windowId) {
  const stored = (await chrome.storage.session.get(key))[key] ?? {};
  if (stored.plan?.expires < Date.now()) delete stored.plan;
  const plan = stored.plan?.title === message.title ? stored.plan : null;

  switch (message.type) {
    case "overview:read": {
      if (typeof message.title !== "string" || !message.title) return null;
      stored.overview = { title: message.title, url: overview };
      const summary = readSummary(message);
      if (!summary) {
        await chrome.storage.session.set({ [key]: stored });
        return false;
      }
      const { credited, target } = summary;
      stored.summary = summary;
      const canContinue = plan?.stage === "overview" && credited < target;
      if (plan?.stage === "overview" && !canContinue) delete stored.plan;
      if (canContinue && validTime(plan.checkpoint) && credited <= plan.checkpoint) {
        plan.verifyFiles = false;
      }
      await chrome.storage.session.set({ [key]: stored });
      return Boolean(canContinue);
    }
    case "overview:continue":
      if (plan?.stage !== "overview") return false;
      plan.stage = "classroom";
      await chrome.storage.session.set({ [key]: stored });
      return true;
    case "classroom:open": {
      const cached = stored.summary;
      const summary = cached?.title === message.title && validTime(cached.credited)
        && validTime(cached.target) && cached.target > 0
        && Date.now() - cached.updated < 1_800_000 ? cached : null;
      const resume = plan?.stage === "classroom" ? plan : null;
      delete stored.plan;
      await chrome.storage.session.set({ [key]: stored });
      return { summary, resume };
    }
    case "classroom:sync": {
      if (typeof message.title !== "string" || !message.title) return null;
      const known = knownOverview.get(message.courseId);
      const page = stored.overview?.title === message.title ? overviewPage(stored.overview.url) : null;
      const url = page ?? overviewPage(message.referrer)
        ?? (known?.title === message.title ? known.url : null);
      if (!url) return { missingPage: true };
      const summary = await readInBackground(url, message.title, windowId);
      if (!summary) return null;
      stored.overview = { title: message.title, url };
      stored.summary = summary;
      await chrome.storage.session.set({ [key]: stored });
      return { summary };
    }
    case "classroom:plan":
      if (typeof message.title !== "string" || !message.title
        || !/^I_SCO_\d+_\d+$/.test(message.lesson ?? "")) return false;
      stored.plan = {
        title: message.title,
        lesson: message.lesson,
        autoNext: message.autoNext === true,
        verifyFiles: message.verifyFiles === true,
        checkpoint: validTime(message.checkpoint) ? message.checkpoint : null,
        stage: "overview",
        expires: Date.now() + resumeLifetime
      };
      await chrome.storage.session.set({ [key]: stored });
      return true;
    case "classroom:cancel":
      if (plan) {
        delete stored.plan;
        await chrome.storage.session.set({ [key]: stored });
      }
      return true;
    default:
      return null;
  }
}
