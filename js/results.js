(function () {
  const root = document.getElementById("app");
  const config = window.TIFLI || {};
  const passKey = "tifli-results-pass";
  let payload = null;
  let filter = "all";

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function questionsOf(audience) {
    return window.TIFLI_SURVEYS[audience].sections.flatMap((section) =>
      section.questions.map((question) => ({ ...question, section: section.title }))
    );
  }

  function optionsOf(question) {
    const base = question.optionSet === "features" ? window.TIFLI_FEATURES : (question.options || []);
    return base.concat(question.extraOptions || []);
  }

  function labelOf(question, code) {
    const found = optionsOf(question).find((option) => option.id === String(code));
    return found ? found.label : String(code);
  }

  function applies(question, answers) {
    return !question.showIf || question.showIf(answers);
  }

  function complete(audience) {
    return (payload.responses || []).filter((row) => {
      if ((row.answers || {}).flow !== "complete") return false;
      if (audience && row.audience !== audience) return false;
      return true;
    });
  }

  async function load(pass) {
    const response = await fetch(`${config.url}/rest/v1/rpc/fetch_results`, {
      method: "POST",
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ pass }),
    });
    const text = await response.text();
    if (!response.ok) {
      let message = "تعذّر فتح النتائج.";
      if (text.includes("forbidden") || response.status === 401) message = "كلمة المرور غير صحيحة.";
      throw new Error(message);
    }
    payload = JSON.parse(text);
    sessionStorage.setItem(passKey, pass);
    renderDashboard();
  }

  function countChoice(rows, question) {
    const pool = rows.filter((row) => applies(question, row.answers || {}));
    const counts = new Map();
    optionsOf(question).forEach((option) => counts.set(option.id, 0));
    pool.forEach((row) => {
      const value = (row.answers || {})[question.id];
      const picked = Array.isArray(value) ? value : (value === undefined || value === null || value === "" ? [] : [value]);
      picked.forEach((code) => {
        if (!counts.has(String(code))) counts.set(String(code), 0);
        counts.set(String(code), counts.get(String(code)) + 1);
      });
    });
    return { pool: pool.length, counts };
  }

  function featureCell(rows, questionId, featureId) {
    const hits = rows.filter((row) => {
      const value = (row.answers || {})[questionId];
      if (Array.isArray(value)) return value.includes(featureId);
      return value === featureId;
    }).length;
    return `${hits}/${rows.length}`;
  }

  function renderGate(message) {
    root.innerHTML = `
      <div class="shell home">
        <div class="top"><div class="mark">طفلي</div><div class="kicker">النتائج</div></div>
        <div class="card">
          <h1>نتائج الاستبيان</h1>
          <p>هذا الرابط لكم فقط. لا ترسلوه في مجموعات واتساب.</p>
          <input class="text-input" data-pass type="password" autocomplete="current-password" placeholder="كلمة المرور">
          <p class="error" data-notice>${escapeHtml(message || "")}</p>
          <div class="actions"><button class="primary" type="button" data-open>فتح النتائج</button></div>
        </div>
      </div>`;
    const input = root.querySelector("[data-pass]");
    const open = () => {
      const pass = input.value;
      root.querySelector("[data-open]").disabled = true;
      load(pass).catch((error) => renderGate(error.message));
    };
    root.querySelector("[data-open]").addEventListener("click", open);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") open();
    });
    input.focus();
  }

  function renderDashboard() {
    const parents = complete("parents");
    const clinicians = complete("clinicians");
    const screened = (payload.responses || []).filter((row) => (row.answers || {}).flow === "screened_out");
    const audienceRows = filter === "parents" ? parents : filter === "clinicians" ? clinicians : parents.concat(clinicians);
    const sources = new Map();
    (payload.responses || []).forEach((row) => {
      const name = row.source || "بدون وسم";
      sources.set(name, (sources.get(name) || 0) + 1);
    });

    root.innerHTML = `
      <div class="shell">
        <div class="top"><div class="mark">طفلي</div><div class="kicker">النتائج</div></div>
        <div class="card">
          <h1>ما وصل حتى الآن</h1>
          <p class="hint">الأرقام مفصولة: لا تجمعوا نسبة الأهل مع نسبة الأطباء. القدرة تدخل النسخة الأولى إذا طلبها الأهل، وأيّدها نصف الأطباء على الأقل، ورفضها أقل من الربع.</p>
          <div class="stats">
            <div class="stat"><b>${parents.length}</b>إجابات أهل مكتملة</div>
            <div class="stat"><b>${clinicians.length}</b>إجابات أطباء مكتملة</div>
            <div class="stat"><b>${screened.length}</b>خارج النطاق</div>
            <div class="stat"><b>${(payload.contacts || []).length}</b>وسائل تواصل منفصلة</div>
          </div>
          <div class="filter">
            <button type="button" data-filter="all" aria-pressed="${filter === "all"}">الكل</button>
            <button type="button" data-filter="parents" aria-pressed="${filter === "parents"}">الأهل</button>
            <button type="button" data-filter="clinicians" aria-pressed="${filter === "clinicians"}">الأطباء</button>
          </div>
          <div class="tools">
            <button type="button" data-refresh>تحديث</button>
            <button type="button" data-csv>تنزيل الإجابات</button>
            <button type="button" data-contacts>تنزيل التواصل</button>
            <button type="button" data-lock>إغلاق</button>
          </div>
        </div>
        ${featureTable(parents, clinicians)}
        ${sourceBlock(sources)}
        ${questionBlocks(audienceRows)}
        ${contactBlock()}
      </div>`;

    root.querySelectorAll("[data-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        filter = button.getAttribute("data-filter");
        renderDashboard();
      });
    });
    root.querySelector("[data-refresh]").addEventListener("click", () => {
      load(sessionStorage.getItem(passKey)).catch((error) => renderGate(error.message));
    });
    root.querySelector("[data-csv]").addEventListener("click", downloadAnswers);
    root.querySelector("[data-contacts]").addEventListener("click", downloadContacts);
    root.querySelector("[data-lock]").addEventListener("click", () => {
      sessionStorage.removeItem(passKey);
      payload = null;
      renderGate("");
    });
  }

  function featureTable(parents, clinicians) {
    const rows = window.TIFLI_FEATURES.map((feature) => `
      <tr>
        <td>${escapeHtml(feature.label)}</td>
        <td>${featureCell(parents, "P15", feature.id)}</td>
        <td>${featureCell(parents, "P16", feature.id)}</td>
        <td>${featureCell(parents, "P17", feature.id)}</td>
        <td>${featureCell(clinicians, "C15", feature.id)}</td>
        <td>${featureCell(clinicians, "C16", feature.id)}</td>
      </tr>`).join("");
    return `
      <div class="card block">
        <h2>مقارنة القدرات</h2>
        <p class="hint">كل خلية: عدد من اختارها / عدد الإجابات المكتملة في تلك المجموعة.</p>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th>القدرة</th>
                <th>أولوية الأهل</th>
                <th>أيضًا في النسخة</th>
                <th>لا يريدها الأهل</th>
                <th>يؤيدها الأطباء</th>
                <th>يرفضها الأطباء</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }

  function sourceBlock(sources) {
    if (sources.size === 0) return "";
    const items = [...sources.entries()].map(([name, count]) => `<li>${escapeHtml(name)}: ${count}</li>`).join("");
    return `<div class="card block"><h2>مصدر الرابط</h2><ul>${items}</ul><p class="hint">أضيفوا ?src=اسم إلى الرابط إذا أرسلتموه إلى أكثر من مجموعة.</p></div>`;
  }

  function questionBlocks(rows) {
    const audiences = filter === "all" ? ["parents", "clinicians"] : [filter];
    const html = audiences.map((audience) => {
      const title = audience === "parents" ? "أسئلة الأهل" : "أسئلة الأطباء";
      const blocks = questionsOf(audience).map((question) => renderQuestion(question, rows.filter((row) => row.audience === audience))).join("");
      return `<div class="card block"><h2>${title}</h2>${blocks}</div>`;
    }).join("");
    return html;
  }

  function renderQuestion(question, rows) {
    if (question.type === "contact" || question.type === "contact-text") {
      return `<div class="q-block"><h3>${escapeHtml(question.id)} · ${escapeHtml(question.title)}</h3><p class="hint">وسيلة التواصل معروضة في القسم المنفصل أسفل الصفحة.</p></div>`;
    }
    const pool = rows.filter((row) => applies(question, row.answers || {}));
    if (question.type === "text") {
      const quotes = pool
        .map((row) => String((row.answers || {})[question.id] || "").trim())
        .filter(Boolean)
        .map((text) => `<div class="quote">${escapeHtml(text)}</div>`)
        .join("");
      return `<div class="q-block"><h3>${escapeHtml(question.id)} · ${escapeHtml(question.title)}</h3>${quotes || `<p class="hint">لا نصوص بعد. المعروض عليهم: ${pool.length}</p>`}</div>`;
    }
    const { counts } = countChoice(pool, question);
    const max = Math.max(1, ...counts.values());
    const bars = [...counts.entries()].map(([code, count]) => {
      const width = Math.round((count / max) * 100);
      return `<div class="q-block" style="margin-top:10px">
        <div>${escapeHtml(labelOf(question, code))}</div>
        <div class="bar"><span style="width:${width}%"></span></div>
        <div class="hint">${count} من ${pool.length}</div>
      </div>`;
    }).join("");
    const details = detailQuotes(question, pool);
    return `<div class="q-block"><h3>${escapeHtml(question.id)} · ${escapeHtml(question.title)}</h3>${bars}${details}</div>`;
  }

  function detailQuotes(question, rows) {
    const lines = [];
    rows.forEach((row) => {
      Object.entries(row.answers || {}).forEach(([key, value]) => {
        if (key.startsWith(`${question.id}__`) && String(value).trim()) {
          lines.push(String(value).trim());
        }
      });
    });
    return lines.map((line) => `<div class="quote">${escapeHtml(line)}</div>`).join("");
  }

  function contactBlock() {
    const contacts = payload.contacts || [];
    const body = contacts.length
      ? contacts.map((item) => {
          const when = new Date(item.created_at).toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" });
          const who = item.audience === "parents" ? "أهل" : "طبيب";
          return `<div class="quote"><b>${who}</b> · ${escapeHtml(when)}<br>${escapeHtml(item.contact)}</div>`;
        }).join("")
      : `<p class="hint">لم يترك أحد وسيلة تواصل.</p>`;
    return `<div class="card block"><h2>تواصل اختياري</h2><p class="hint">هذا القسم منفصل عن إجابات الاستبيان. لا تنشرونه.</p>${body}</div>`;
  }

  function csvEscape(value) {
    const text = Array.isArray(value) ? value.join("|") : value === undefined || value === null ? "" : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  }

  function download(filename, rows) {
    const blob = new Blob(["\uFEFF" + rows], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function downloadAnswers() {
    const rows = payload.responses || [];
    const keys = new Set();
    rows.forEach((row) => {
      Object.keys(row.answers || {}).forEach((key) => {
        if (!key.startsWith("_")) keys.add(key);
      });
    });
    const columns = ["id", "audience", "source", "created_at", ...keys];
    const lines = [columns.join(",")];
    rows.forEach((row) => {
      const values = columns.map((column) => {
        if (column === "id" || column === "audience" || column === "source" || column === "created_at") {
          return csvEscape(row[column]);
        }
        return csvEscape((row.answers || {})[column]);
      });
      lines.push(values.join(","));
    });
    download("tifli-answers.csv", lines.join("\n"));
  }

  function downloadContacts() {
    const lines = ["id,response_id,audience,created_at,contact"];
    (payload.contacts || []).forEach((item) => {
      lines.push(["id", "response_id", "audience", "created_at", "contact"].map((key) => csvEscape(item[key])).join(","));
    });
    download("tifli-contacts.csv", lines.join("\n"));
  }

  const saved = sessionStorage.getItem(passKey);
  if (saved) load(saved).catch(() => renderGate(""));
  else renderGate("");
})();
