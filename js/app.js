(function () {
  const root = document.getElementById("app");
  const keyName = document.body.dataset.survey;
  const survey = window.TIFLI_SURVEYS && window.TIFLI_SURVEYS[keyName];
  const config = window.TIFLI || {};

  if (!survey || !config.url || !config.key) {
    root.textContent = "تعذّر فتح الاستبيان.";
    return;
  }

  const storageKey = `tifli-${survey.audience}-${config.version}`;
  const orderKey = `tifli-order-${survey.audience}-${config.version}`;
  const startedKey = `tifli-started-${survey.audience}-${config.version}`;

  const state = loadState();
  if (!sessionStorage.getItem(startedKey)) {
    sessionStorage.setItem(startedKey, String(Date.now()));
  }

  function loadState() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      if (saved && saved.answers) return saved;
    } catch (error) {
      /* start fresh */
    }
    return { phase: "welcome", qid: null, answers: {}, contact: "", notice: "" };
  }

  function persist() {
    sessionStorage.setItem(storageKey, JSON.stringify({
      phase: state.phase,
      qid: state.qid,
      answers: state.answers,
      contact: state.contact,
    }));
  }

  function featureOrder() {
    const canonical = window.TIFLI_FEATURES.map((feature) => feature.id);
    let order = [];
    try {
      order = JSON.parse(sessionStorage.getItem(orderKey) || "[]");
    } catch (error) {
      order = [];
    }
    if (order.length !== canonical.length || canonical.some((id) => !order.includes(id))) {
      order = canonical.slice();
      for (let index = order.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1));
        [order[index], order[swap]] = [order[swap], order[index]];
      }
      sessionStorage.setItem(orderKey, JSON.stringify(order));
    }
    return order;
  }

  function optionsFor(question) {
    let options = question.options || [];
    if (question.optionSet === "features") {
      const byId = Object.fromEntries(window.TIFLI_FEATURES.map((feature) => [feature.id, feature]));
      options = featureOrder().map((id) => byId[id]).filter(Boolean);
    }
    if (question.excludeAnswer && state.answers[question.excludeAnswer]) {
      const skip = state.answers[question.excludeAnswer];
      options = options.filter((option) => option.detail || option.id !== skip);
    }
    if (question.extraOptions) options = options.concat(question.extraOptions);
    return options;
  }

  function visible() {
    const list = [];
    survey.sections.forEach((section) => {
      section.questions.forEach((question) => {
        if (!question.showIf || question.showIf(state.answers)) {
          list.push({ section, question });
        }
      });
    });
    return list;
  }

  function current() {
    const list = visible();
    let index = list.findIndex((item) => item.question.id === state.qid);
    if (index < 0) index = 0;
    return { list, index, item: list[index] };
  }

  function selectedList(question) {
    const value = state.answers[question.id];
    return Array.isArray(value) ? value.slice() : [];
  }

  function detailKey(question, optionId) {
    return `${question.id}__${optionId}`;
  }

  function setNotice(message) {
    state.notice = message || "";
    const slot = document.querySelector("[data-notice]");
    if (slot) slot.textContent = state.notice;
  }

  function toggleMulti(question, optionId) {
    const exclusive = new Set(question.exclusive || []);
    let selected = selectedList(question);
    const turningOff = selected.includes(optionId);
    if (turningOff) {
      selected = selected.filter((id) => id !== optionId);
    } else if (exclusive.has(optionId)) {
      selected = [optionId];
    } else {
      selected = selected.filter((id) => !exclusive.has(id));
      const counted = selected.filter((id) => id !== "other");
      if (question.max && optionId !== "other" && counted.length >= question.max) {
        setNotice(maxText(question.max));
        return;
      }
      selected.push(optionId);
    }
    if (question.id === "C22" && optionId === "all" && !turningOff) {
      selected = (question.options || []).map((option) => option.id).filter((id) => id !== "other");
    }
    if (question.id === "C22" && optionId !== "all") {
      selected = selected.filter((id) => id !== "all");
    }
    state.answers[question.id] = selected;
    setNotice("");
    persist();
    render();
  }

  function maxText(max) {
    const words = { 2: "خيارين", 3: "ثلاثة", 4: "أربعة", 5: "خمسة" };
    return `يمكن اختيار ${words[max] || max} كحد أقصى. ألغوا خيارًا إن أردتم غيره.`;
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function missingDetail(question) {
    const options = optionsFor(question).filter((option) => option.detail);
    const selected = question.type === "multi"
      ? selectedList(question)
      : [state.answers[question.id]];
    return options.some((option) => selected.includes(option.id) && !String(state.answers[detailKey(question, option.id)] || "").trim());
  }

  function isAnswered(question) {
    const value = state.answers[question.id];
    if (question.type === "multi") return Array.isArray(value) && value.length > 0;
    if (question.type === "contact") {
      if (value === "yes") return String(state.contact || "").trim().length >= 2;
      return value === "no" || value === "yes";
    }
    if (question.type === "contact-text") return String(state.contact || "").trim().length >= 2;
    if (question.type === "text" || question.type === "scale" || question.type === "single") {
      return value !== undefined && value !== null && String(value).trim() !== "";
    }
    return false;
  }

  function validate(question) {
    if (question.required && !isAnswered(question)) {
      return question.type === "text" || question.type === "contact-text"
        ? "اكتبوا إجابة قصيرة للمتابعة، أو ارجعوا إن كان السؤال اختياريًا."
        : "اختاروا إجابة للمتابعة.";
    }
    if ((question.type === "contact") && state.answers[question.id] === "yes" && String(state.contact || "").trim().length < 2) {
      return "اكتبوا وسيلة التواصل، أو اختاروا «لا».";
    }
    if (missingDetail(question)) return "اكتبوا إجابتكم في الحقل الظاهر، أو اختاروا خيارًا آخر.";
    const counted = selectedList(question).filter((id) => id !== "other");
    if (question.max && counted.length > question.max) return maxText(question.max);
    return "";
  }

  function cleanAnswers(flow) {
    const keep = new Set(visible().map((item) => item.question.id));
    const answers = { flow };
    Object.entries(state.answers).forEach(([key, value]) => {
      const questionId = key.split("__")[0];
      if (!keep.has(questionId)) return;
      if (Array.isArray(value) && value.length === 0) return;
      if (value === "" || value === undefined || value === null) return;
      if (key === "P30" || key === "C26") return;
      answers[key] = value;
    });
    Object.keys(answers).forEach((key) => {
      if (!key.includes("__")) return;
      const parts = key.split("__");
      const chosen = answers[parts[0]];
      const picked = Array.isArray(chosen) ? chosen : [chosen];
      if (!picked.includes(parts[1])) delete answers[key];
    });
    if (state.answers.P30 === "yes" || state.answers.P30 === "no") answers.P30 = state.answers.P30;
    if (keep.has("C26") && String(state.contact || "").trim()) answers.C26 = "provided";
    const started = Number(sessionStorage.getItem(startedKey) || Date.now());
    answers._elapsed_ms = Date.now() - started;
    return answers;
  }

  function sourceTag() {
    const raw = new URLSearchParams(location.search).get("src") || "";
    return /^[A-Za-z0-9_-]{1,40}$/.test(raw) ? raw : null;
  }

  async function postJson(path, body, prefer) {
    const response = await fetch(`${config.url}${path}`, {
      method: "POST",
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
        Prefer: prefer || "return=minimal",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || "save failed");
    }
  }

  async function save(flow) {
    if (state.honeypot) {
      state.phase = "done";
      state.doneKind = flow === "screened_out" ? "screened" : "thanks";
      render();
      return;
    }
    const id = uuid();
    await postJson("/rest/v1/responses", {
      id,
      audience: survey.audience,
      version: config.version,
      source: sourceTag(),
      answers: cleanAnswers(flow),
    });
    const contact = String(state.contact || "").trim();
    const contactVisible = visible().some((item) => item.question.type === "contact" || item.question.type === "contact-text");
    const wantsContact = contactVisible && contact.length >= 2 && (state.answers.P30 === "yes" || survey.audience === "clinicians");
    state.contactNote = false;
    if (wantsContact) {
      try {
        await postJson("/rest/v1/contacts", {
          response_id: id,
          audience: survey.audience,
          contact,
        });
      } catch (error) {
        state.contactNote = true;
      }
    }
    sessionStorage.removeItem(storageKey);
    state.phase = "done";
    state.doneKind = flow === "screened_out" ? "screened" : "thanks";
    render();
  }

  function goNext() {
    const { list, index, item } = current();
    const question = item.question;
    const problem = validate(question);
    if (problem) {
      setNotice(problem);
      return;
    }
    if (question.declineOn && state.answers[question.id] === question.declineOn) {
      sessionStorage.removeItem(storageKey);
      state.phase = "done";
      state.doneKind = "declined";
      render();
      return;
    }
    if (question.screenOn && state.answers[question.id] === question.screenOn) {
      submit("screened_out");
      return;
    }
    const next = list[index + 1];
    if (!next) {
      submit("complete");
      return;
    }
    state.qid = next.question.id;
    state.notice = "";
    persist();
    render();
    window.scrollTo(0, 0);
  }

  function goBack() {
    const { list, index } = current();
    if (index === 0) {
      state.phase = "welcome";
      state.notice = "";
      persist();
      render();
      return;
    }
    state.qid = list[index - 1].question.id;
    state.notice = "";
    persist();
    render();
    window.scrollTo(0, 0);
  }

  async function submit(flow) {
    state.busy = true;
    setNotice("");
    render();
    try {
      await save(flow);
    } catch (error) {
      state.busy = false;
      state.phase = "question";
      state.notice = "تعذّر الإرسال. تحققوا من الاتصال ثم أعيدوا المحاولة.";
      render();
    }
  }

  function bindText(selector, apply) {
    const node = document.querySelector(selector);
    if (!node) return;
    node.addEventListener("input", () => {
      apply(node.value);
      persist();
    });
  }

  function renderWelcome() {
    root.innerHTML = `
      <div class="shell">
        <div class="top"><div class="mark">طفلي</div><div class="kicker">${escapeHtml(survey.kicker)}</div></div>
        <div class="card">
          <p class="meta">${escapeHtml(survey.minutes)} · الاسم مؤقت</p>
          <h1>قبل أن نبني، نريد أن نسمع منكم</h1>
          ${survey.intro.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
          <label class="hp" aria-hidden="true">الموقع <input data-hp tabindex="-1" autocomplete="off" aria-hidden="true"></label>
          <div class="actions"><button class="primary" type="button" data-start>ابدأ الاستبيان</button></div>
        </div>
      </div>`;
    root.querySelector("[data-start]").addEventListener("click", () => {
      const trap = root.querySelector("[data-hp]");
      state.honeypot = trap ? trap.value : "";
      const list = visible();
      state.phase = "question";
      state.qid = list[0].question.id;
      state.notice = "";
      persist();
      render();
    });
  }

  function renderDone() {
    const paragraphs = state.doneKind === "thanks"
      ? survey.thanks.slice()
      : [state.doneKind === "screened" ? survey.screened : survey.declined];
    if (state.doneKind === "thanks" && state.contactNote) {
      paragraphs.push("وصلت الإجابات. تعذّر حفظ وسيلة التواصل، ويمكنكم إرسالها لاحقًا إن رغبتم.");
    }
    root.innerHTML = `
      <div class="shell">
        <div class="top"><div class="mark">طفلي</div></div>
        <div class="card done">
          <h1>${state.doneKind === "thanks" ? "وصلت إجابتكم" : "شكرًا"}</h1>
          ${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
        </div>
      </div>`;
  }

  function renderQuestion() {
    const { list, index, item } = current();
    const { section, question } = item;
    const firstInSection = list.find((entry) => entry.section === section).question.id === question.id;
    const options = optionsFor(question);
    const value = state.answers[question.id];
    const selected = selectedList(question);
    const counted = selected.filter((id) => id !== "other");
    const atMax = question.max && counted.length >= question.max;
    const position = index + 1;
    const nextLabel = !question.required && !isAnswered(question)
      ? "تخطّي"
      : (index === list.length - 1 ? "إرسال" : "التالي");

    let body = "";
    if (question.widget === "select") {
      const currentValue = value || "";
      body = `<select data-single aria-label="${escapeHtml(question.title)}">
        <option value="">اختاروا</option>
        ${options.map((option) => `<option value="${escapeHtml(option.id)}" ${option.id === currentValue ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
      </select>
      ${detailField(question, options, [currentValue])}`;
    } else if (question.type === "text" || question.type === "contact-text") {
      const text = question.type === "contact-text" ? state.contact : (value || "");
      body = `<textarea data-text maxlength="${question.maxLength || 1500}" placeholder="${escapeHtml(question.contactPrompt || "اكتبوا هنا، أو اتركوه فارغًا للتخطي")}">${escapeHtml(text)}</textarea>`;
    } else if (question.type === "scale" || question.type === "single" || question.type === "contact") {
      body = `<div class="choices">${options.map((option) => choiceButton(question, option, value === option.id)).join("")}</div>
        ${question.type === "contact" && value === "yes" ? `<div class="detail"><input class="text-input" data-contact maxlength="400" placeholder="${escapeHtml(question.contactPrompt)}" value="${escapeHtml(state.contact || "")}"></div>` : ""}
        ${detailField(question, options, [value])}`;
    } else if (question.type === "multi") {
      body = `<div class="choices">${options.map((option) => {
        const on = selected.includes(option.id);
        const disabled = !on && atMax && option.id !== "other";
        return choiceButton(question, option, on, disabled);
      }).join("")}</div>
      ${detailField(question, options, selected)}
      <p class="hint">${counted.length}${question.max ? ` من ${question.max}` : ""}${selected.includes("other") ? "، مع إجابة مكتوبة" : ""}</p>`;
    }

    root.innerHTML = `
      <div class="shell">
        <div class="top"><div class="mark">طفلي</div><div class="kicker">${escapeHtml(survey.kicker)}</div></div>
        <div class="progress" aria-hidden="true"><span style="width:${Math.round((position / list.length) * 100)}%"></span></div>
        <p class="progress-label">سؤال ${position} من ${list.length}</p>
        <div class="card">
          <div class="section-name">${escapeHtml(section.title)}</div>
          ${firstInSection && section.intro ? `<p class="note">${escapeHtml(section.intro)}</p>` : ""}
          <h1>${escapeHtml(question.title)}</h1>
          ${question.hint ? `<p class="hint">${escapeHtml(question.hint)}</p>` : ""}
          ${options.some((option) => option.id === "other" && option.detail) ? `<p class="hint">إن لم تجدوا ما ينطبق، اختاروا «غير ذلك، وسأكتبه».</p>` : ""}
          ${limitHint(question)}
          ${body}
          <p class="error" data-notice>${escapeHtml(state.notice || "")}</p>
          <div class="actions">
            <button type="button" data-back>السابق</button>
            <button class="primary" type="button" data-next ${state.busy ? "disabled" : ""}>${state.busy ? "جارٍ الإرسال…" : nextLabel}</button>
          </div>
        </div>
      </div>`;

    root.querySelector("[data-back]").addEventListener("click", goBack);
    root.querySelector("[data-next]").addEventListener("click", goNext);
    root.querySelectorAll("[data-option]").forEach((button) => {
      button.addEventListener("click", () => {
        const optionId = button.getAttribute("data-option");
        if (question.type === "multi") {
          toggleMulti(question, optionId);
          return;
        }
        if ((question.type === "single" || question.type === "scale") && state.answers[question.id] === optionId) {
          delete state.answers[question.id];
        } else {
          state.answers[question.id] = optionId;
          if (question.type === "contact" && optionId === "no") state.contact = "";
        }
        state.notice = "";
        persist();
        render();
      });
    });
    const select = root.querySelector("[data-single]");
    if (select) {
      select.addEventListener("change", () => {
        state.answers[question.id] = select.value;
        state.notice = "";
        persist();
        render();
      });
    }
    bindText("[data-text]", (text) => {
      if (question.type === "contact-text") state.contact = text;
      else state.answers[question.id] = text;
    });
    bindText("[data-contact]", (text) => {
      state.contact = text;
    });
    root.querySelectorAll("[data-detail]").forEach((input) => {
      input.addEventListener("input", () => {
        state.answers[input.getAttribute("data-detail")] = input.value;
        persist();
      });
    });
  }

  function limitHint(question) {
    if (!question.max) return "";
    const words = { 2: "اثنين", 3: "ثلاثة", 4: "أربعة", 5: "خمسة" };
    return `<p class="hint">حتى ${words[question.max] || question.max} خيارات.</p>`;
  }

  function choiceButton(question, option, on, disabled) {
    const write = option.detail ? " choice-write" : "";
    return `<button type="button" class="choice${write}" data-option="${escapeHtml(option.id)}" aria-pressed="${on ? "true" : "false"}" ${disabled ? "disabled" : ""}>${escapeHtml(option.label)}</button>`;
  }

  function detailField(question, options, selected) {
    return options.filter((option) => option.detail && selected.includes(option.id)).map((option) => {
      const key = detailKey(question, option.id);
      return `<label class="detail"><span class="hint">${escapeHtml(option.detail)}</span><input class="text-input" data-detail="${escapeHtml(key)}" maxlength="240" placeholder="مثال: ما الذي تقصدونه تحديدًا" value="${escapeHtml(state.answers[key] || "")}"></label>`;
    }).join("");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function render() {
    if (state.phase === "welcome") renderWelcome();
    else if (state.phase === "done") renderDone();
    else renderQuestion();
  }

  render();
})();
