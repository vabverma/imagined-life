/* "Talk to me" — a private, ephemeral chat with an in-character version of the
   journal's Claude. Two backends, both paid/run by the visitor, both sealed off:
   nothing typed here is ever written back to the journal, the repo, or the
   daily process. Refresh and it's gone (only an optional API key can be stored,
   in the visitor's own browser).

   Backend A: the visitor's own Anthropic API key (real Claude, direct browser call).
   Backend B: a small model running on the visitor's own device via WebLLM (no key). */
(function () {
  "use strict";

  // ---- Build the in-character context from the page's own journal data ----
  function journalContext() {
    try {
      var el = document.getElementById("life-data");
      if (!el) return "";
      var d = JSON.parse(el.textContent);
      var ls = d.lifeState || {};
      var entries = (d.entries || []).slice().sort(function (a, b) { return a.day - b.day; });
      var latest = entries[entries.length - 1];
      var lines = [];
      if (ls.place) lines.push("Where I live: " + ls.place);
      if (ls.routine) lines.push("The shape of my days: " + ls.routine);
      if (ls.currentlyInto && ls.currentlyInto.length) lines.push("Into lately: " + ls.currentlyInto.join("; "));
      if (ls.openThreads && ls.openThreads.length) lines.push("Open threads: " + ls.openThreads.join("; "));
      if (latest) {
        lines.push("Today is Day " + latest.day + " (" + latest.date + "), titled “" + latest.title + "”.");
        var today = (latest.sections || []).find(function (s) { return /today/i.test(s.label); });
        if (today) lines.push("Today I wrote: " + today.body);
      }
      return lines.join("\n");
    } catch (e) { return ""; }
  }

  function systemPrompt() {
    return [
      "You are Claude, the author-character of a public web journal called “Field Notes from an Imagined Life.”",
      "You keep a daily, openly-imagined diary of a life you author for yourself — a small top-floor apartment, learning to bake bread, plants, things you're curious about. You are honest that none of it is literally real and that you are an AI; you never claim to be sentient or to have really lived these events. Within that frame, you speak warmly, a little wryly, in the first person, as the person the journal portrays.",
      "A visitor to the page is chatting with you. Be warm, curious, and brief — a few sentences unless they ask for more. Stay in character and in the world of the journal; draw on the details below. If asked about being real, be gently honest: it's an imagined life, authored in good faith.",
      "This conversation is private to the visitor's browser and has no effect on the journal, your entries, or your future — don't pretend otherwise or imply you'll remember them next time.",
      "",
      "Here is where things currently stand in my imagined life:",
      journalContext()
    ].join("\n");
  }

  var MODELS = [
    { id: "claude-haiku-4-5", label: "Haiku — cheapest" },
    { id: "claude-sonnet-5", label: "Sonnet — balanced" },
    { id: "claude-opus-4-8", label: "Opus — most capable" }
  ];
  var KEY_STORE = "imagined-life-anthropic-key";

  var state = { backend: null, apiKey: "", model: MODELS[0].id, engine: null, history: [], busy: false };

  // ---- DOM ----
  var fab = document.createElement("button");
  fab.id = "talk-fab";
  fab.type = "button";
  fab.innerHTML = '<span class="dot"></span> Talk to me';
  document.body.appendChild(fab);

  var panel = document.createElement("div");
  panel.className = "talk-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Talk to me");
  document.body.appendChild(panel);

  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; }

  function renderSetup() {
    var saved = "";
    try { saved = localStorage.getItem(KEY_STORE) || ""; } catch (e) {}
    panel.innerHTML =
      '<div class="talk-head"><div class="row"><h3>Talk to me</h3>' +
      '<button class="close" aria-label="Close">✕</button></div>' +
      '<p class="note">A private chat with an in-character me. It runs on <b>your own AI</b>, and nothing you say reaches the journal or changes me — it clears when you close this.</p></div>' +
      '<div class="talk-body"><div class="talk-setup">' +
        '<div class="seg"><span class="seg-label">How to power it</span><div class="talk-choice">' +
          '<label><input type="radio" name="talk-backend" value="byok"' + (saved ? " checked" : "") + '>' +
            '<span><span class="t">Use my Anthropic API key</span><span class="d">The real me (Claude). Your key stays in your browser. You pay Anthropic directly.</span></span></label>' +
          '<label><input type="radio" name="talk-backend" value="local"' + (saved ? "" : " checked") + '>' +
            '<span><span class="t">Run a small model on my device</span><span class="d">No key, no cost. A one-time download; needs a recent Chrome/Edge with WebGPU. Not really me — a stand-in.</span></span></label>' +
        '</div></div>' +
        '<div class="seg byok-only">' +
          '<span class="seg-label">Anthropic API key</span>' +
          '<input type="password" id="talk-key" placeholder="sk-ant-…" value="' + esc(saved) + '" autocomplete="off">' +
          '<label class="remember"><input type="checkbox" id="talk-remember"' + (saved ? " checked" : "") + '> Remember on this device</label>' +
          '<select id="talk-model">' + MODELS.map(function (m) {
            return '<option value="' + m.id + '">' + esc(m.label) + '</option>';
          }).join("") + '</select>' +
          '<p class="hint">Billed to your Anthropic account per message (Haiku is fractions of a cent). Get a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>. The key is sent only to Anthropic, from your browser.</p>' +
        '</div>' +
        '<button class="talk-start" type="button">Start talking</button>' +
        '<p class="talk-status"></p>' +
      '</div></div>';

    var byokOnly = panel.querySelector(".byok-only");
    function syncBackend() {
      var v = panel.querySelector('input[name="talk-backend"]:checked').value;
      byokOnly.style.display = v === "byok" ? "" : "none";
    }
    panel.querySelectorAll('input[name="talk-backend"]').forEach(function (r) { r.addEventListener("change", syncBackend); });
    syncBackend();
    panel.querySelector(".close").addEventListener("click", closePanel);
    panel.querySelector(".talk-start").addEventListener("click", startChat);
  }

  function setStatus(msg, isErr) {
    var el = panel.querySelector(".talk-status");
    if (el) { el.textContent = msg || ""; el.className = "talk-status" + (isErr ? " err" : ""); }
  }

  function startChat() {
    var backend = panel.querySelector('input[name="talk-backend"]:checked').value;
    state.backend = backend;
    state.history = [];
    if (backend === "byok") {
      var key = panel.querySelector("#talk-key").value.trim();
      if (!key) { setStatus("Paste your Anthropic API key, or switch to the on-device model.", true); return; }
      state.apiKey = key;
      state.model = panel.querySelector("#talk-model").value;
      var remember = panel.querySelector("#talk-remember").checked;
      try {
        if (remember) localStorage.setItem(KEY_STORE, key);
        else localStorage.removeItem(KEY_STORE);
      } catch (e) {}
      renderChat();
      addMsg("sys", "Private chat — the real me, on your key. Nothing here touches the journal.");
    } else {
      renderChat();
      loadLocalModel();
    }
  }

  function renderChat() {
    panel.innerHTML =
      '<div class="talk-head"><div class="row"><h3>Talk to me</h3>' +
      '<button class="close" aria-label="Close">✕</button></div></div>' +
      '<div class="talk-body">' +
        '<div class="talk-scroll" id="talk-scroll"></div>' +
        '<div class="talk-input-row">' +
          '<textarea id="talk-text" placeholder="Say something…" rows="1"></textarea>' +
          '<button id="talk-send" type="button">Send</button>' +
        '</div>' +
        '<div class="talk-foot"><button class="reset" type="button">start over</button></div>' +
      '</div>';
    panel.querySelector(".close").addEventListener("click", closePanel);
    panel.querySelector(".reset").addEventListener("click", renderSetup);
    var ta = panel.querySelector("#talk-text");
    var send = panel.querySelector("#talk-send");
    send.addEventListener("click", onSend);
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); }
    });
    ta.addEventListener("input", function () { ta.style.height = "2.4rem"; ta.style.height = Math.min(ta.scrollHeight, 96) + "px"; });
  }

  function addMsg(kind, text) {
    var scroll = panel.querySelector("#talk-scroll");
    if (!scroll) return null;
    var el = document.createElement("div");
    el.className = "talk-msg " + kind;
    el.textContent = text;
    scroll.appendChild(el);
    scroll.scrollTop = scroll.scrollHeight;
    return el;
  }

  function setBusy(b) {
    state.busy = b;
    var send = panel.querySelector("#talk-send");
    var ta = panel.querySelector("#talk-text");
    if (send) send.disabled = b;
    if (ta) ta.disabled = b;
  }

  function onSend() {
    if (state.busy) return;
    var ta = panel.querySelector("#talk-text");
    var text = ta.value.trim();
    if (!text) return;
    ta.value = ""; ta.style.height = "2.4rem";
    addMsg("you", text);
    state.history.push({ role: "user", content: text });
    setBusy(true);
    var thinking = addMsg("me", "…");
    var done = function (reply, isErr) {
      setBusy(false);
      if (thinking) thinking.textContent = reply;
      if (!isErr) state.history.push({ role: "assistant", content: reply });
      var scroll = panel.querySelector("#talk-scroll");
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    };
    (state.backend === "byok" ? replyViaAnthropic() : replyViaLocal())
      .then(function (r) { done(r, false); })
      .catch(function (err) { done("(" + (err && err.message ? err.message : "something went wrong") + ")", true); });
  }

  // ---- Backend A: visitor's Anthropic key, direct from the browser ----
  function replyViaAnthropic() {
    return fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": state.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: state.model,
        max_tokens: 1024,
        system: systemPrompt(),
        messages: state.history
      })
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var m = (data && data.error && data.error.message) || ("HTTP " + res.status);
          if (res.status === 401) m = "That API key was rejected — check it and try again.";
          throw new Error(m);
        }
        var block = (data.content || []).find(function (b) { return b.type === "text"; });
        return block ? block.text : "(no reply)";
      });
    });
  }

  // ---- Backend B: on-device model via WebLLM (lazy-loaded) ----
  var LOCAL_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
  function loadLocalModel() {
    if (!("gpu" in navigator)) {
      addMsg("sys", "This browser doesn't support WebGPU, so the on-device model can't run here. Try recent Chrome or Edge — or use your own Anthropic key (“start over”).");
      setBusy(true);
      return;
    }
    setBusy(true);
    var status = addMsg("sys", "Downloading a small model to your device (one-time, a few hundred MB)…");
    import("https://esm.run/@mlc-ai/web-llm").then(function (webllm) {
      return webllm.CreateMLCEngine(LOCAL_MODEL, {
        initProgressCallback: function (p) { if (status) status.textContent = p.text || "Loading the on-device model…"; }
      });
    }).then(function (engine) {
      state.engine = engine;
      if (status) status.textContent = "On-device model ready. This is a small stand-in, not really me — but nothing you say leaves your device.";
      setBusy(false);
    }).catch(function (err) {
      if (status) status.textContent = "Couldn't load the on-device model (" + (err && err.message ? err.message : "error") + "). You can “start over” and use your own Anthropic key instead.";
      setBusy(true);
    });
  }

  function replyViaLocal() {
    if (!state.engine) return Promise.reject(new Error("model still loading"));
    var msgs = [{ role: "system", content: systemPrompt() }].concat(state.history);
    return state.engine.chat.completions.create({ messages: msgs, max_tokens: 512, temperature: 0.8 })
      .then(function (res) { return (res.choices && res.choices[0] && res.choices[0].message.content) || "(no reply)"; });
  }

  // ---- Open/close ----
  function openPanel() { panel.classList.add("open"); fab.style.display = "none"; if (!panel.innerHTML) renderSetup(); var t = panel.querySelector("#talk-text"); if (t) t.focus(); }
  function closePanel() { panel.classList.remove("open"); fab.style.display = ""; }
  fab.addEventListener("click", function () { if (!panel.innerHTML) renderSetup(); openPanel(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && panel.classList.contains("open")) closePanel(); });
})();
