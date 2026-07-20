(function () {
  "use strict";

  const VANI_API_BASE = "https://uiusvs-ai.uiusvs2025.workers.dev";
  const VANI_IMAGE_PATH = "/Frontend/vani.png";

  const USED_QUESTIONS_KEY = "svs_vani_used_questions";
  const CHAT_HISTORY_KEY = "svs_vani_chat_history";
  const LANG_KEY = "svs_vani_lang";

  const STR = {
    en: {
      subtitle: "Your Sanatan Guide",
      placeholder: "Ask something...",
      greeting:
        "🙏 Jai Shree Krishna! I am SVS Vani. Ask me anything about Sanatan Dharma, UIUSVS, or the developer, or pick an option below.",
      suggestions: [
        "What is Sanatan Dharma?",
        "Give me another quiz",
        "Tell me about UIUSVS",
      ],
      error:
        "Sorry, I'm having trouble responding right now. Please try again in a moment. 🙏",
      closeAria: "Close",
      fabAria: "Open SVS Vani Chat",
      sendAria: "Send",
      langBtn: "বাং",
      loading: "✨ SVS Vani is preparing your questions...",
      loadError: "Could not load questions. Please try again.",
      answerAll: "Please answer all 3 questions.",
      resultLoading: "Getting your result...",
      resultLoadingText: "SVS Vani is checking your result...",
      thanks: "Thank you for participating! 🙏",
      resultTitle: "Result",
      moodTitle: {
        excellent: "Excellent! 🏆",
        good: "Great! 🌸",
        poor: "Nice try! 🕉️",
      },
    },
    bn: {
      subtitle: "তোমার সনাতন সহায়ক",
      placeholder: "কিছু জিজ্ঞেস করো...",
      greeting:
        "🙏 জয় শ্রী কৃষ্ণ! আমি SVS Vani। সনাতন ধর্ম, UIUSVS বা ডেভেলপার নিয়ে যেকোনো প্রশ্ন করো, অথবা নিচের একটা অপশন বেছে নাও।",
      suggestions: ["সনাতন ধর্ম কী?", "আরেকটা কুইজ দাও", "UIUSVS সম্পর্কে বলো"],
      error:
        "দুঃখিত, এই মুহূর্তে উত্তর দিতে সমস্যা হচ্ছে। একটু পরে আবার চেষ্টা করো। 🙏",
      closeAria: "বন্ধ করো",
      fabAria: "SVS Vani Chat খুলুন",
      sendAria: "পাঠাও",
      langBtn: "EN",
      loading: "✨ SVS Vani is preparing your questions...",
      loadError: "Could not load questions. Please try again.",
      answerAll: "Please answer all 3 questions.",
      resultLoading: "Getting your result...",
      resultLoadingText: "SVS Vani is checking your result...",
      thanks: "Thank you for participating! 🙏",
      resultTitle: "Result",
      moodTitle: {
        excellent: "Excellent! 🏆",
        good: "Great! 🌸",
        poor: "Nice try! 🕉️",
      },
    },
  };

  function getLang() {
    try {
      return localStorage.getItem(LANG_KEY) === "bn" ? "bn" : "en";
    } catch (e) {
      return "en";
    }
  }

  function setLang(lang) {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch (e) {}
  }

  function getUsedQuestions() {
    try {
      return JSON.parse(localStorage.getItem(USED_QUESTIONS_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }

  function addUsedQuestions(questions) {
    const existing = getUsedQuestions();
    const updated = existing
      .concat(questions.map((q) => q.question))
      .slice(-200);
    localStorage.setItem(USED_QUESTIONS_KEY, JSON.stringify(updated));
  }

  function getChatHistory() {
    try {
      return JSON.parse(sessionStorage.getItem(CHAT_HISTORY_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }

  function saveChatHistory(history) {
    sessionStorage.setItem(
      CHAT_HISTORY_KEY,
      JSON.stringify(history.slice(-20)),
    );
  }

  async function apiPost(path, body, opts) {
    const timeout = (opts && opts.timeout) || 20000;
    const retries = (opts && opts.retries) || 1;
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await fetch(`${VANI_API_BASE}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error("SVS Vani API error: " + res.status);
        return await res.json();
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;
      }
    }
    throw lastErr;
  }

  function escapeHtml(str) {
    return (str || "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }

  function linkify(html) {
    const urlRegex = /(https?:\/\/[^\s<]+)|(www\.[^\s<]+)/g;
    return html.replace(urlRegex, (match) => {
      let trail = "";
      while (match.length && /[.,!?;:|)\]]$/.test(match)) {
        trail = match.slice(-1) + trail;
        match = match.slice(0, -1);
      }
      const href = match.startsWith("http") ? match : "https://" + match;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color:#ea580c;text-decoration:underline;font-weight:600;">${match}</a>${trail}`;
    });
  }

  const styles = `
    .svs-vani-fab {
      position: fixed; bottom: 24px; right: 20px; z-index: 9500;
      width: 58px; height: 58px; border-radius: 50%;
      background: linear-gradient(135deg,#b91c1c 0%,#ea580c 100%);
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 6px 20px rgba(185,28,28,0.4);
      cursor: pointer; border: 2px solid rgba(255,255,255,0.6);
      transition: transform 0.25s ease, box-shadow 0.25s ease;
      font-size: 26px; overflow: hidden;
    }
    .svs-vani-fab:hover { transform: scale(1.08); box-shadow: 0 8px 26px rgba(185,28,28,0.55); }
    .svs-vani-fab img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; position: relative; z-index: 2; }
    .svs-vani-fab .svs-vani-pulse {
      position: absolute; inset: 0; border-radius: 50%;
      border: 2px solid #ea580c; animation: svsVaniPulse 2.2s infinite;
    }
    @keyframes svsVaniPulse {
      0% { transform: scale(1); opacity: 0.6; }
      100% { transform: scale(1.6); opacity: 0; }
    }

    .svs-vani-window {
      position: fixed; bottom: 92px; right: 20px; z-index: 9500;
      width: 340px; max-width: calc(100vw - 32px);
      height: 480px; max-height: calc(100vh - 140px);
      background: #fffaf0; border-radius: 20px; overflow: hidden;
      box-shadow: 0 20px 50px rgba(74,4,4,0.3);
      border: 2px solid #fbbf24;
      display: flex; flex-direction: column;
      transform: translateY(20px) scale(0.95); opacity: 0; pointer-events: none;
      transition: all 0.3s cubic-bezier(0.22,1,0.36,1);
      font-family: 'Inter', sans-serif;
    }
    .svs-vani-window.svs-vani-open {
      transform: translateY(0) scale(1); opacity: 1; pointer-events: auto;
    }

    .svs-vani-header {
      background: linear-gradient(135deg,#991b1b 0%,#ea580c 100%);
      color: #fff; padding: 14px 16px; display: flex; align-items: center;
      gap: 10px; flex-shrink: 0;
    }
    .svs-vani-header-icon {
      width: 34px; height: 34px; border-radius: 50%; background: rgba(255,255,255,0.2);
      display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0;
      overflow: hidden;
    }
    .svs-vani-header-icon img { width: 100%; height: 100%; object-fit: cover; }
    .svs-vani-header-text { flex: 1; min-width: 0; }
    .svs-vani-header-title { font-weight: 800; font-size: 15px; font-family: 'Playfair Display', serif; }
    .svs-vani-header-sub { font-size: 10px; opacity: 0.85; }
    .svs-vani-lang-btn {
      background: rgba(255,255,255,0.18); border: 1px solid rgba(255,255,255,0.4); color: #fff;
      font-size: 11px; font-weight: 700; padding: 5px 9px; border-radius: 999px; cursor: pointer;
      flex-shrink: 0;
    }
    .svs-vani-lang-btn:hover { background: rgba(255,255,255,0.32); }
    .svs-vani-close-btn {
      background: rgba(255,255,255,0.15); border: none; color: #fff; width: 26px; height: 26px;
      border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center;
      font-size: 14px; flex-shrink: 0;
    }
    .svs-vani-close-btn:hover { background: rgba(255,255,255,0.3); }

    .svs-vani-body {
      flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px;
    }
    .svs-vani-body::-webkit-scrollbar { width: 6px; }
    .svs-vani-body::-webkit-scrollbar-thumb { background: #fdba74; border-radius: 10px; }

    .svs-vani-msg { max-width: 84%; padding: 9px 13px; border-radius: 14px; font-size: 13px; line-height: 1.5; }
    .svs-vani-msg-bot {
      background: #fff; border: 1px solid #fed7aa; color: #4a0404;
      align-self: flex-start; border-bottom-left-radius: 4px;
    }
    .svs-vani-msg-user {
      background: linear-gradient(135deg,#b91c1c,#ea580c); color: #fff;
      align-self: flex-end; border-bottom-right-radius: 4px;
    }
    .svs-vani-typing { display: flex; gap: 4px; padding: 10px 13px; }
    .svs-vani-typing span {
      width: 6px; height: 6px; border-radius: 50%; background: #ea580c;
      animation: svsVaniTyping 1s infinite ease-in-out;
    }
    .svs-vani-typing span:nth-child(2) { animation-delay: 0.15s; }
    .svs-vani-typing span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes svsVaniTyping { 0%,60%,100%{transform:translateY(0);opacity:0.4;} 30%{transform:translateY(-4px);opacity:1;} }

    .svs-vani-suggestions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
    .svs-vani-chip {
      background: #fff7ed; border: 1px solid #fdba74; color: #b45309;
      font-size: 11px; font-weight: 600; padding: 6px 10px; border-radius: 999px;
      cursor: pointer; transition: all 0.2s;
    }
    .svs-vani-chip:hover { background: #fed7aa; }

    .svs-vani-quiz-card {
      background: #fff; border: 1px solid #fed7aa; border-radius: 12px; padding: 10px;
      align-self: flex-start; max-width: 92%; font-size: 12.5px;
    }
    .svs-vani-quiz-q { font-weight: 700; color: #7c2d12; margin-bottom: 8px; }
    .svs-vani-quiz-opt {
      display: block; width: 100%; text-align: left; background: #fff7ed; border: 1px solid #fed7aa;
      border-radius: 8px; padding: 7px 10px; margin-bottom: 6px; cursor: pointer; font-size: 12px;
      color: #4a0404; transition: all 0.15s;
    }
    .svs-vani-quiz-opt:hover { background: #fde3c7; }
    .svs-vani-quiz-opt.svs-vani-correct { background: #dcfce7; border-color: #22c55e; }
    .svs-vani-quiz-opt.svs-vani-wrong { background: #fee2e2; border-color: #ef4444; }

    .svs-vani-input-row {
      display: flex; align-items: center; gap: 8px; padding: 10px; border-top: 1px solid #fed7aa;
      background: #fff; flex-shrink: 0;
    }
    .svs-vani-input {
      flex: 1; border: 1px solid #fed7aa; border-radius: 999px; padding: 9px 14px; font-size: 13px;
      outline: none; background: #fffaf0;
    }
    .svs-vani-input:focus { border-color: #ea580c; }
    .svs-vani-send-btn {
      width: 34px; height: 34px; border-radius: 50%; border: none; flex-shrink: 0;
      background: linear-gradient(135deg,#b91c1c,#ea580c); color: #fff; cursor: pointer;
      display: flex; align-items: center; justify-content: center; font-size: 14px;
    }
    .svs-vani-send-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    @media (max-width: 480px) {
      .svs-vani-window { right: 12px; bottom: 84px; width: calc(100vw - 24px); }
      .svs-vani-fab { right: 14px; bottom: 16px; }
    }
  `;

  function injectStyles() {
    if (document.getElementById("svs-vani-styles")) return;
    const styleEl = document.createElement("style");
    styleEl.id = "svs-vani-styles";
    styleEl.textContent = styles;
    document.head.appendChild(styleEl);
  }

  let chatOpen = false;
  let chatHistory = [];
  let currentLang = getLang();
  let bodyEl, inputEl, sendBtn, langBtn, subtitleEl, closeBtn, fabEl;

  function buildChatWidget() {
    const fab = document.createElement("div");
    fab.className = "svs-vani-fab";
    fab.innerHTML = `<span class="svs-vani-pulse"></span><img src="${VANI_IMAGE_PATH}" alt="SVS Vani" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'🕉️',style:'position:relative;z-index:2;font-size:26px;'}))" />`;
    fab.setAttribute("aria-label", STR[currentLang].fabAria);
    fabEl = fab;

    const win = document.createElement("div");
    win.className = "svs-vani-window";
    win.innerHTML = `
      <div class="svs-vani-header">
        <div class="svs-vani-header-icon"><img src="${VANI_IMAGE_PATH}" alt="SVS Vani" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'🕉️'}))" /></div>
        <div class="svs-vani-header-text">
          <div class="svs-vani-header-title">SVS Vani</div>
          <div class="svs-vani-header-sub"></div>
        </div>
        <button class="svs-vani-lang-btn"></button>
        <button class="svs-vani-close-btn" aria-label="Close">✕</button>
      </div>
      <div class="svs-vani-body"></div>
      <div class="svs-vani-input-row">
        <input class="svs-vani-input" type="text" />
        <button class="svs-vani-send-btn" aria-label="Send">➤</button>
      </div>
    `;

    document.body.appendChild(fab);
    document.body.appendChild(win);

    bodyEl = win.querySelector(".svs-vani-body");
    inputEl = win.querySelector(".svs-vani-input");
    sendBtn = win.querySelector(".svs-vani-send-btn");
    langBtn = win.querySelector(".svs-vani-lang-btn");
    subtitleEl = win.querySelector(".svs-vani-header-sub");
    closeBtn = win.querySelector(".svs-vani-close-btn");

    applyLangUI();

    fab.addEventListener("click", () => toggleChat(win));
    closeBtn.addEventListener("click", () => toggleChat(win, false));
    sendBtn.addEventListener("click", () => handleSend());
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleSend();
    });
    langBtn.addEventListener("click", () => {
      currentLang = currentLang === "en" ? "bn" : "en";
      setLang(currentLang);
      applyLangUI();
    });

    chatHistory = getChatHistory();
    if (chatHistory.length === 0) {
      appendBotMessage(STR[currentLang].greeting, STR[currentLang].suggestions);
    } else {
      chatHistory.forEach((m) => {
        if (m.role === "user") appendUserMessage(m.content, false);
        else appendBotMessage(m.content, [], false);
      });
      scrollToBottom();
    }
  }

  function applyLangUI() {
    const s = STR[currentLang];
    subtitleEl.textContent = s.subtitle;
    inputEl.placeholder = s.placeholder;
    langBtn.textContent = s.langBtn;
    closeBtn.setAttribute("aria-label", s.closeAria);
    sendBtn.setAttribute("aria-label", s.sendAria);
    fabEl.setAttribute("aria-label", s.fabAria);
  }

  function toggleChat(win, force) {
    chatOpen = typeof force === "boolean" ? force : !chatOpen;
    win.classList.toggle("svs-vani-open", chatOpen);
    if (chatOpen) setTimeout(() => inputEl.focus(), 300);
  }

  function scrollToBottom() {
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function appendUserMessage(text, save) {
    if (save === undefined) save = true;
    const el = document.createElement("div");
    el.className = "svs-vani-msg svs-vani-msg-user";
    el.textContent = text;
    bodyEl.appendChild(el);
    scrollToBottom();
    if (save) {
      chatHistory.push({ role: "user", content: text });
      saveChatHistory(chatHistory);
    }
  }

  function appendBotMessage(text, suggestions, save) {
    if (suggestions === undefined) suggestions = [];
    if (save === undefined) save = true;
    const el = document.createElement("div");
    el.className = "svs-vani-msg svs-vani-msg-bot";
    el.innerHTML = linkify(escapeHtml(text).replace(/\n/g, "<br>"));
    bodyEl.appendChild(el);

    if (suggestions && suggestions.length) {
      const wrap = document.createElement("div");
      wrap.className = "svs-vani-suggestions";
      suggestions.forEach((s) => {
        const chip = document.createElement("button");
        chip.className = "svs-vani-chip";
        chip.textContent = s;
        chip.addEventListener("click", () => {
          inputEl.value = s;
          handleSend();
        });
        wrap.appendChild(chip);
      });
      bodyEl.appendChild(wrap);
    }

    scrollToBottom();
    if (save) {
      chatHistory.push({ role: "assistant", content: text });
      saveChatHistory(chatHistory);
    }
  }

  function appendTypingIndicator() {
    const el = document.createElement("div");
    el.className = "svs-vani-msg svs-vani-msg-bot svs-vani-typing-wrapper";
    el.innerHTML = `<div class="svs-vani-typing"><span></span><span></span><span></span></div>`;
    bodyEl.appendChild(el);
    scrollToBottom();
    return el;
  }

  function appendInlineQuiz(quiz) {
    const card = document.createElement("div");
    card.className = "svs-vani-quiz-card";
    card.innerHTML = `
      <div class="svs-vani-quiz-q">🧠 ${escapeHtml(quiz.question)}</div>
      ${quiz.options
        .map(
          (opt, i) =>
            `<button class="svs-vani-quiz-opt" data-idx="${i}">${escapeHtml(opt)}</button>`,
        )
        .join("")}
    `;
    card.querySelectorAll(".svs-vani-quiz-opt").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.idx, 10);
        card
          .querySelectorAll(".svs-vani-quiz-opt")
          .forEach((b) => (b.disabled = true));
        if (idx === quiz.answer) {
          btn.classList.add("svs-vani-correct");
        } else {
          btn.classList.add("svs-vani-wrong");
          card.children[quiz.answer + 1]?.classList.add("svs-vani-correct");
        }
      });
    });
    bodyEl.appendChild(card);
    scrollToBottom();
  }

  async function handleSend() {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = "";
    sendBtn.disabled = true;

    appendUserMessage(text);
    const typingEl = appendTypingIndicator();

    try {
      const data = await apiPost(
        "/api/vani/chat",
        { message: text, history: chatHistory.slice(0, -1), lang: currentLang },
        { timeout: 20000, retries: 1 },
      );
      typingEl.remove();
      appendBotMessage(data.reply, data.suggestions || []);
      if (data.quiz) appendInlineQuiz(data.quiz);
    } catch (e) {
      typingEl.remove();
      appendBotMessage(STR[currentLang].error);
    } finally {
      sendBtn.disabled = false;
    }
  }

  async function mountQuiz(opts) {
    const {
      wrapperId = "quiz-questions-wrapper",
      containerId = "quiz-container",
      resultId = "quiz-result",
      scoreId = "quiz-score",
      totalId = "quiz-total-score",
      feedbackTitleId = "quiz-feedback-title",
      feedbackTextId = "quiz-feedback-text",
    } = opts || {};

    const wrapper = document.getElementById(wrapperId);
    const container = document.getElementById(containerId);
    const resultBox = document.getElementById(resultId);
    if (!wrapper || !container || !resultBox) return;

    let currentQuestions = [];
    const s = STR.en;
    const diffLabel = { easy: "Easy", medium: "Medium", hard: "Hard" };

    async function loadQuestions() {
      wrapper.innerHTML = `<div style="text-align:center;padding:20px;color:#9a3412;font-size:13px;">${s.loading}</div>`;
      try {
        const exclude = getUsedQuestions();
        const data = await apiPost(
          "/api/vani/quiz",
          { exclude },
          { timeout: 20000, retries: 1 },
        );
        currentQuestions = data.questions;
        addUsedQuestions(currentQuestions);
        renderQuestions();
      } catch (e) {
        wrapper.innerHTML = `<div style="text-align:center;padding:20px;color:#b91c1c;font-size:13px;">${s.loadError}</div>`;
      }
    }

    function renderQuestions() {
      wrapper.innerHTML = currentQuestions
        .map((q, i) => {
          const opts = q.options
            .map(
              (opt, oi) => `
              <label class="flex items-start p-3 border border-gray-200 rounded-xl cursor-pointer hover:bg-orange-50 transition-colors bg-white">
                <input type="radio" name="svs-q${i}" value="${oi}" class="mr-3 mt-0.5 flex-shrink-0 text-orange-500 focus:ring-orange-500 w-4 h-4">
                <span class="text-sm sm:text-base leading-tight">${escapeHtml(opt)}</span>
              </label>`,
            )
            .join("");
          return `
            <div class="quiz-question block">
              <h3 class="font-bold text-base sm:text-lg text-gray-800 mb-3 leading-tight font-serif">
                <span class="text-orange-600 mr-1">${i + 1}.</span> ${escapeHtml(q.question)}
                <span style="font-size:10px;background:#fed7aa;color:#9a3412;padding:2px 8px;border-radius:999px;margin-left:6px;vertical-align:middle;">${diffLabel[q.difficulty] || q.difficulty}</span>
              </h3>
              <div class="space-y-2.5 font-medium text-gray-700 text-sm sm:text-base">${opts}</div>
            </div>`;
        })
        .join('<hr class="my-6 border-orange-100/50">');
    }

    async function submit() {
      let score = 0;
      let allAnswered = true;
      currentQuestions.forEach((q, i) => {
        const sel = document.querySelector(`input[name="svs-q${i}"]:checked`);
        if (sel) {
          if (parseInt(sel.value, 10) === q.answer) score++;
        } else {
          allAnswered = false;
        }
      });
      if (!allAnswered) {
        alert(s.answerAll);
        return;
      }

      container.classList.add("hidden");
      document.getElementById(scoreId).textContent = score;
      const totalEl = document.getElementById(totalId);
      if (totalEl) totalEl.textContent = currentQuestions.length;

      const titleEl = document.getElementById(feedbackTitleId);
      const textEl = document.getElementById(feedbackTextId);
      if (titleEl) titleEl.textContent = s.resultLoading;
      if (textEl) textEl.textContent = s.resultLoadingText;
      resultBox.classList.remove("hidden");
      resultBox.scrollIntoView({ behavior: "smooth", block: "center" });

      try {
        const data = await apiPost(
          "/api/vani/feedback",
          { score, total: currentQuestions.length, lang: "en" },
          { timeout: 15000, retries: 1 },
        );
        const moodTitle = s.moodTitle[data.mood] || s.resultTitle;
        if (titleEl) titleEl.textContent = moodTitle;
        if (textEl) textEl.textContent = data.feedback;
      } catch (e) {
        if (titleEl) titleEl.textContent = s.resultTitle;
        if (textEl) textEl.textContent = s.thanks;
      }
    }

    function reset() {
      resultBox.classList.add("hidden");
      container.classList.remove("hidden");
      loadQuestions();
    }

    window.submitQuiz = submit;
    window.resetQuiz = reset;

    loadQuestions();
  }

  window.SVSVani = {
    initChat: function () {
      injectStyles();
      if (!document.querySelector(".svs-vani-fab")) buildChatWidget();
    },
    mountQuiz: mountQuiz,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () =>
      window.SVSVani.initChat(),
    );
  } else {
    window.SVSVani.initChat();
  }
})();
