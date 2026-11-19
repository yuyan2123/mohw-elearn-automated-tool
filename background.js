const overviewHosts = new Set(["elearn.hrd.gov.tw", "mohw.elearn.hrd.gov.tw"]);
const resumeLifetime = 120_000;
const queues = new Map();

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message?.type || !sender.url || sender.tab?.id == null) return;
  const url = new URL(sender.url);
  if (url.protocol !== "https:") return;
  const overview = sender.frameId === 0 && overviewHosts.has(url.hostname)
    && /^\/info\/\d+\/?$/.test(url.pathname);
  const classroom = sender.frameId > 0 && url.hostname === "mohw.elearn.hrd.gov.tw"
    && url.pathname === "/learn/mooc_sysbar.php";
  if (
    !(overview && message.type.startsWith("overview:")) &&
    !(classroom && message.type.startsWith("classroom:"))
  ) return;

  const key = `course-${sender.tab.id}`;
  const previous = queues.get(key) ?? Promise.resolve();
  const work = previous.then(() => update(key, message));
  const queued = work.catch(() => {});
  queues.set(key, queued);
  work.then(respond, () => respond(null)).finally(() => {
    if (queues.get(key) === queued) queues.delete(key);
  });
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  const key = `course-${tabId}`;
  const pending = queues.get(key) ?? Promise.resolve();
  void pending.then(() => chrome.storage.session.remove(key)).catch(() => {});
});

async function update(key, message) {
  const stored = (await chrome.storage.session.get(key))[key] ?? {};
  if (stored.plan?.expires < Date.now()) delete stored.plan;
  const plan = stored.plan?.title === message.title ? stored.plan : null;

  switch (message.type) {
    case "overview:read": {
      if (typeof message.title !== "string" || !message.title) return null;
      const validTime = value => Number.isSafeInteger(value) && value >= 0;
      const credited = validTime(message.credited) ? message.credited : null;
      const target = validTime(message.target) && message.target > 0 ? message.target : null;
      stored.summary = { title: message.title, credited, target, updated: Date.now() };
      const canContinue = plan?.stage === "overview" && credited != null
        && target != null && credited < target;
      if (!canContinue) delete stored.plan;
      await chrome.storage.session.set({ [key]: stored });
      return Boolean(canContinue);
    }
    case "overview:continue":
      if (plan?.stage !== "overview") return false;
      plan.stage = "classroom";
      await chrome.storage.session.set({ [key]: stored });
      return true;
    case "classroom:open": {
      const summary = stored.summary?.title === message.title
        && Date.now() - stored.summary.updated < 1_800_000 ? stored.summary : null;
      const resume = plan?.stage === "classroom" ? plan : null;
      delete stored.plan;
      await chrome.storage.session.set({ [key]: stored });
      return { summary, resume };
    }
    case "classroom:plan":
      if (typeof message.title !== "string" || !message.title
        || !/^I_SCO_\d+_\d+$/.test(message.lesson ?? "")) return false;
      stored.plan = {
        title: message.title,
        lesson: message.lesson,
        autoNext: message.autoNext === true,
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
