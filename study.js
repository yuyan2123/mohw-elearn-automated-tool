globalThis.Study = (() => {
  const officialTime = /閱讀時數\s*[：:]\s*(\d{1,4}:[0-5]\d:[0-5]\d)(\s*[（(]\s*含\s*[）)]\s*以上)?/g;

  function seconds(value) {
    return value.split(":").reduce((total, part) => total * 60 + Number(part), 0);
  }

  function summary(visibleText, fullText) {
    const recorded = [...visibleText.matchAll(officialTime)].find(match => !match[2]);
    const target = [...fullText.matchAll(officialTime)].find(match => match[2]);
    return {
      credited: recorded ? seconds(recorded[1]) : null,
      target: target ? seconds(target[1]) : null
    };
  }

  function title(text) {
    return text
      .replace(/^e等公務園\+學習平臺\s*[-–—]\s*/, "")
      .replace(/\s*[-–—]\s*衛生福利e學園$/, "")
      .trim()
      .replace(/\s+/g, "");
  }

  function format(value) {
    if (value == null) return "—";
    const total = Math.max(0, Math.floor(value));
    return [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60]
      .map(part => String(part).padStart(2, "0"))
      .join(":");
  }

  return { summary, title, format };
})();
