/* LeagueGuide: same-origin chat client. Answers are rendered as plain text. */
(function () {
  "use strict";
  // LeagueGuide is off until the chat backend runs on Cloudflare (it was built for
  // Netlify Functions). Change false to true to bring the "Ask LeagueGuide" button back.
  const CHAT_ENABLED = false;
  if (!CHAT_ENABLED) return;
  if (document.getElementById("league-guide")) return;
  const sections = new Set([
    "overview",
    "profile",
    "starts",
    "trades",
    "comebacks",
    "saber",
    "opportunity",
    "luck",
    "weekly",
    "records",
    "drafts",
    "moves",
    "charts",
    "sharing",
    "players",
  ]);
  const suggestions = [
    [
      "Scoring+ vs. record",
      "Why can a manager have a high Scoring+ but a losing record?",
    ],
    [
      "xFP vs. fantasy points",
      "What is the difference between xFP, FPOE and fantasy points?",
    ],
    [
      "Lineup regret",
      "How is lineup regret calculated, and what does it leave out?",
    ],
    [
      "Using the filters",
      "How do the season, manager and platform filters work?",
    ],
  ];
  const node = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const button = (className, text) => {
    const el = node("button", className, text);
    el.type = "button";
    return el;
  };
  const host = node("div", "league-guide");
  host.id = "league-guide";
  const launcher = button("lg-launcher", "Ask LeagueGuide");
  launcher.setAttribute("aria-expanded", "false");
  launcher.setAttribute("aria-controls", "lg-panel");
  launcher.setAttribute("aria-haspopup", "dialog");
  const panel = node("section", "lg-panel");
  panel.id = "lg-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-labelledby", "lg-title");
  panel.setAttribute("aria-describedby", "lg-description");
  const header = node("header", "lg-header");
  const headingGroup = node("div", "lg-heading-group");
  headingGroup.append(node("span", "lg-eyebrow", "Your league, explained"));
  const title = node("h2", "lg-title", "LeagueGuide");
  title.id = "lg-title";
  headingGroup.append(title);
  const controls = node("div", "lg-controls");
  const reset = button("lg-reset", "New chat");
  reset.disabled = true;
  const close = button("lg-close", "×");
  close.setAttribute("aria-label", "Close LeagueGuide");
  controls.append(reset, close);
  header.append(headingGroup, controls);
  const context = node("p", "lg-context");
  context.id = "lg-description";
  const transcript = node("div", "lg-transcript");
  transcript.setAttribute("role", "log");
  transcript.setAttribute("aria-label", "LeagueGuide conversation");
  transcript.setAttribute("aria-live", "polite");
  transcript.setAttribute("aria-relevant", "additions");
  transcript.tabIndex = 0;
  const welcome = node("div", "lg-welcome");
  welcome.append(
    node("h3", "", "Make sense of every stat."),
    node(
      "p",
      "",
      "Ask about a metric, a manager, a matchup or how to use the site. I’ll use the saved league data and show you where to look.",
    ),
  );
  const prompts = node("div", "lg-prompts");
  prompts.setAttribute("aria-label", "Suggested questions");
  const promptButtons = suggestions.map(([label, question]) => {
    const b = button("lg-prompt", label);
    b.title = question;
    b.onclick = () => {
      input.value = question;
      updateCount();
      send(question);
    };
    return b;
  });
  prompts.append(...promptButtons);
  welcome.append(prompts);
  transcript.append(welcome);
  const feedback = node("div", "lg-feedback");
  const status = node("p", "lg-status");
  status.setAttribute("role", "status");
  const retry = button("lg-retry", "Try again");
  retry.hidden = true;
  feedback.append(status, retry);
  const form = node("form", "lg-form");
  const label = node("label", "lg-input-label", "Your question");
  label.htmlFor = "lg-input";
  const input = node("textarea", "lg-input");
  input.id = "lg-input";
  input.name = "message";
  input.maxLength = 1500;
  input.rows = 2;
  input.placeholder = "What does Scoring+ tell me?";
  input.required = true;
  input.disabled = true;
  input.setAttribute("aria-describedby", "lg-count lg-privacy");
  const footer = node("div", "lg-form-footer");
  const count = node("span", "lg-count", "0 / 1,500");
  count.id = "lg-count";
  const submit = button("lg-send", "Send question");
  submit.type = "submit";
  submit.disabled = true;
  footer.append(count, submit);
  form.append(label, input, footer);
  const privacy = node(
    "p",
    "lg-privacy",
    "Questions and relevant league stats are sent to Groq. Avoid sharing personal information. AI answers can be mistaken; check the linked sections.",
  );
  privacy.id = "lg-privacy";
  panel.append(header, context, transcript, feedback, form, privacy);
  host.append(launcher, panel);
  document.body.append(host);

  let session = null;
  let bootPromise = null;
  let busy = false;
  let retryAction = null;

  function selection() {
    const out = document.getElementById("out");
    const platform = out?.dataset.chatPlatform || "all";
    const section =
      out?.dataset.activeSection ||
      (document.title === "Players" ? "players" : "overview");
    return {
      section: sections.has(section) ? section : "overview",
      manager: out?.dataset.chatManager || "all",
      season: out?.dataset.chatSeason || "all",
      platform: ["all", "ESPN", "Sleeper"].includes(platform)
        ? platform
        : "all",
      scope: out?.dataset.chatScope === "external" ? "external" : "saved",
      games: ["regular", "postseason"].includes(out?.dataset.chatGames)
        ? out.dataset.chatGames
        : "all",
      trade: section === "trades" ? out?.dataset.chatTrade || "" : "",
      matchup: section === "comebacks" ? out?.dataset.chatMatchup || "" : "",
      position:
        section === "starts" ? out?.dataset.chatPosition || "all" : "all",
    };
  }
  function updateContext() {
    const s = selection();
    if (s.scope === "external") {
      context.textContent =
        "I can explain the stats here. Manager and matchup answers use this site’s saved league; switch to Our league for those.";
      return;
    }
    const page =
      document.querySelector(
        `#out .feature-tabs button[data-section="${s.section}"]`,
      )?.textContent || (s.section === "players" ? "Players" : "Overview");
    const season = s.season === "all" ? "all seasons" : s.season;
    const platform = s.platform === "all" ? "all platforms" : s.platform;
    const games =
      s.section === "starts"
        ? ` · ${s.games === "all" ? "all matchups" : s.games === "regular" ? "regular season" : "postseason"}`
        : "";
    context.textContent = `Viewing ${page} · ${season} · ${platform}${games}. Answers use the saved league snapshot.`;
  }
  function updateCount() {
    count.textContent = `${input.value.length.toLocaleString()} / 1,500`;
    submit.disabled = busy || !session?.configured || !input.value.trim();
  }
  function setBusy(value) {
    busy = value;
    input.disabled = value || !session?.configured;
    reset.disabled = value || !session;
    promptButtons.forEach((b) => {
      b.disabled = value || !session?.configured;
    });
    form.setAttribute("aria-busy", String(value));
    submit.textContent = value ? "Thinking…" : "Send question";
    updateCount();
  }
  function feedbackText(message, action = null) {
    status.textContent = message;
    retryAction = action;
    retry.hidden = !action;
  }
  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(path, {
        credentials: "same-origin",
        cache: "no-store",
        ...options,
        signal: controller.signal,
      });
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error(
          "LeagueGuide needs the chat server. Start it with node server.mjs, then open the address it prints.",
        );
      }
      const result = await response.json();
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new Error("LeagueGuide returned an invalid response. Try again.");
      }
      if (!response.ok) {
        if (response.status === 403) session = null;
        throw new Error(
          typeof result.error === "string"
            ? result.error.slice(0, 600)
            : "LeagueGuide is unavailable right now.",
        );
      }
      return result;
    } catch (error) {
      if (error.name === "AbortError")
        throw new Error("That answer took too long. Please try again.");
      if (error instanceof TypeError)
        throw new Error(
          "Couldn’t reach LeagueGuide. Start node server.mjs and open the address it prints, or check your connection.",
        );
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }
  async function boot() {
    if (session) return Boolean(session.configured);
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      setBusy(true);
      if (!/^https?:$/.test(window.location.protocol)) {
        feedbackText(
          "Open this report through the chat server to use LeagueGuide: run node server.mjs, then open the address it prints.",
        );
        setBusy(false);
        return false;
      }
      feedbackText("Connecting to LeagueGuide…");
      try {
        const data = await request("/api/chat/session");
        if (
          typeof data.csrfToken !== "string" ||
          typeof data.configured !== "boolean"
        )
          throw new Error(
            "LeagueGuide returned an invalid session. Try again.",
          );
        session = data;
        feedbackText(
          session.configured
            ? ""
            : "LeagueGuide hasn’t been configured by the site owner yet.",
        );
        return session.configured;
      } catch (error) {
        feedbackText(error.message, boot);
        return false;
      } finally {
        setBusy(false);
      }
    })();
    try {
      return await bootPromise;
    } finally {
      bootPromise = null;
    }
  }
  function appendMessage(role, text, sources = []) {
    const message = node("article", `lg-message lg-${role}`);
    message.append(
      node("p", "lg-message-label", role === "user" ? "You" : "LeagueGuide"),
    );
    message.append(node("p", "lg-message-text", text));
    if (Array.isArray(sources) && sources.length) {
      const links = node("div", "lg-sources");
      links.setAttribute("aria-label", "Related sections");
      for (const source of sources.slice(0, 6)) {
        if (
          !source ||
          !sections.has(source.section) ||
          typeof source.label !== "string"
        )
          continue;
        const target = document.querySelector(
          `#out .feature-tabs button[data-section="${source.section}"]`,
        );
        if (target) {
          const b = button("lg-source", source.label.slice(0, 120));
          b.onclick = () => {
            document
              .querySelector(
                `#out .feature-tabs button[data-section="${source.section}"]`,
              )
              ?.click();
            hide();
            document
              .querySelector(
                `#out .feature-tabs button[data-section="${source.section}"]`,
              )
              ?.focus();
          };
          links.append(b);
        } else {
          const link = node(
            "a",
            "lg-source",
            `${source.label.slice(0, 120)} ↗`,
          );
          link.href =
            source.section === "players" ? "players.html" : "index.html";
          link.setAttribute(
            "aria-label",
            `${source.label.slice(0, 120)} — open ${source.section === "players" ? "players" : "dashboard"}`,
          );
          links.append(link);
        }
      }
      if (links.childElementCount) message.append(links);
    }
    transcript.append(message);
    transcript.scrollTop = transcript.scrollHeight;
  }
  async function send(message, retrying = false) {
    const text = message.trim();
    if (!text || text.length > 1500 || busy) return;
    setBusy(true);
    if (!(await boot())) {
      setBusy(false);
      return;
    }
    setBusy(true);
    if (!retrying) {
      welcome.hidden = true;
      appendMessage("user", text);
      input.value = "";
    }
    feedbackText("Looking at the league data…");
    try {
      const response = await request("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Chat-CSRF": session.csrfToken,
        },
        body: JSON.stringify({ message: text, selection: selection() }),
      });
      if (typeof response.answer !== "string" || !response.answer.trim())
        throw new Error("LeagueGuide didn’t return an answer. Try again.");
      appendMessage(
        "assistant",
        response.answer.slice(0, 24000),
        response.sources,
      );
      feedbackText("");
    } catch (error) {
      feedbackText(error.message, () => send(text, true));
    } finally {
      setBusy(false);
      if (!panel.hidden && !input.disabled)
        input.focus({ preventScroll: true });
    }
  }
  function hide() {
    panel.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    launcher.focus({ preventScroll: true });
  }
  launcher.onclick = async () => {
    if (!panel.hidden) {
      hide();
      return;
    }
    panel.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    updateContext();
    close.focus({ preventScroll: true });
    const connected = await boot();
    if (connected && !panel.hidden) input.focus({ preventScroll: true });
  };
  close.onclick = hide;
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      hide();
    }
  });
  input.addEventListener("input", updateCount);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    send(input.value);
  });
  retry.onclick = () => retryAction?.();
  reset.onclick = async () => {
    if (busy || !session) return;
    setBusy(true);
    feedbackText("Starting a new chat…");
    try {
      const result = await request("/api/chat/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Chat-CSRF": session.csrfToken,
        },
        body: "{}",
      });
      if (
        typeof result.csrfToken !== "string" ||
        typeof result.configured !== "boolean"
      )
        throw new Error("Couldn’t start a new chat. Please try again.");
      session = result;
      transcript.replaceChildren(welcome);
      welcome.hidden = false;
      input.value = "";
      feedbackText(
        session.configured
          ? ""
          : "LeagueGuide hasn’t been configured by the site owner yet.",
      );
    } catch (error) {
      feedbackText(error.message);
    } finally {
      setBusy(false);
      if (!input.disabled) input.focus({ preventScroll: true });
    }
  };
  const out = document.getElementById("out");
  if (out)
    new MutationObserver(updateContext).observe(out, {
      attributes: true,
      attributeFilter: [
        "data-active-section",
        "data-chat-manager",
        "data-chat-season",
        "data-chat-platform",
        "data-chat-scope",
        "data-chat-games",
        "data-chat-trade",
        "data-chat-matchup",
        "data-chat-position",
      ],
    });
  setBusy(false);
  updateContext();
})();
