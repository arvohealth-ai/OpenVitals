export const renderDashboardPage = (apiBaseUrl: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenVitals Dashboard</title>
    <style>
      :root {
        --paper: #f5efe2;
        --ink: #1f2a24;
        --muted: #5f6c65;
        --accent: #0f766e;
        --accent-soft: #d7efe9;
        --alert: #9f2d2d;
        --warn: #9a5a00;
        --card: rgba(255, 255, 255, 0.72);
        --border: rgba(31, 42, 36, 0.12);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Space Grotesk", "Avenir Next", "Segoe UI", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(15, 118, 110, 0.18), transparent 32%),
          radial-gradient(circle at 80% 10%, rgba(187, 94, 37, 0.12), transparent 24%),
          linear-gradient(180deg, #fbf6ea 0%, var(--paper) 100%);
      }
      main {
        width: min(1180px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 28px 0 48px;
      }
      .hero {
        display: grid;
        gap: 18px;
        padding: 32px;
        border: 1px solid var(--border);
        border-radius: 28px;
        background: linear-gradient(135deg, rgba(255,255,255,0.92), rgba(215,239,233,0.66));
        box-shadow: 0 18px 40px rgba(31, 42, 36, 0.08);
      }
      .eyebrow {
        letter-spacing: 0.18em;
        text-transform: uppercase;
        font-size: 12px;
        color: var(--muted);
      }
      h1 {
        margin: 0;
        font-size: clamp(2.6rem, 8vw, 5rem);
        line-height: 0.95;
      }
      .sub {
        margin: 0;
        color: var(--muted);
        max-width: 720px;
        font-size: 1.04rem;
      }
      .grid {
        display: grid;
        gap: 16px;
        margin-top: 22px;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      }
      .card {
        padding: 20px;
        border-radius: 22px;
        border: 1px solid var(--border);
        background: var(--card);
        backdrop-filter: blur(12px);
      }
      .card h2 {
        margin: 0 0 10px;
        font-size: 1.02rem;
        letter-spacing: 0.03em;
        text-transform: uppercase;
      }
      .metric {
        font-size: 2rem;
        font-weight: 700;
      }
      .alert-high { color: var(--alert); }
      pre {
        overflow: auto;
        padding: 14px;
        border-radius: 16px;
        background: rgba(31, 42, 36, 0.06);
        font-size: 12px;
      }
      .list {
        display: grid;
        gap: 12px;
      }
      .row {
        display: grid;
        gap: 6px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--border);
      }
      .row:last-child { border-bottom: 0; padding-bottom: 0; }
      .detail {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        color: var(--muted);
        font-size: 12px;
      }
      .pill,
      .tag {
        display: inline-block;
        padding: 6px 10px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 12px;
        font-weight: 700;
      }
      .tag { padding: 4px 8px; }
      .quality-ok { background: rgba(15, 118, 110, 0.12); color: var(--accent); }
      .quality-stale { background: rgba(154, 90, 0, 0.12); color: var(--warn); }
      .quality-missing,
      .quality-unknown { background: rgba(159, 45, 45, 0.12); color: var(--alert); }
      .empty,
      .error {
        color: var(--muted);
        padding: 12px;
        border: 1px dashed var(--border);
        border-radius: 14px;
      }
      .error { color: var(--alert); }
      @media (max-width: 768px) {
        main { width: min(100vw - 18px, 1180px); padding-top: 18px; }
        .hero { padding: 22px; border-radius: 22px; }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div class="eyebrow">Health OS / Engineering Console</div>
        <h1>OpenVitals</h1>
        <p class="sub">Local-first proactive health runtime with dedupe explainability, score transparency, and data-quality context for agent-safe decisions.</p>
        <span class="pill">API ${apiBaseUrl}</span>
      </section>
      <section class="grid">
        <article class="card">
          <h2>Connectors</h2>
          <div id="connectors" class="metric">...</div>
          <div id="connector-list" class="list"></div>
        </article>
        <article class="card">
          <h2>Data Quality</h2>
          <div id="quality" class="metric">...</div>
          <div id="quality-list" class="list"></div>
        </article>
        <article class="card">
          <h2>Scores</h2>
          <div id="scores" class="metric">...</div>
          <div id="score-list" class="list"></div>
        </article>
        <article class="card">
          <h2>Alerts</h2>
          <div id="alerts" class="metric">...</div>
          <div id="alert-list" class="list"></div>
        </article>
      </section>
      <section class="grid">
        <article class="card">
          <h2>Dedupe Explain</h2>
          <pre id="explain">Loading...</pre>
        </article>
        <article class="card">
          <h2>Automation Runs</h2>
          <pre id="runs">Loading...</pre>
        </article>
      </section>
    </main>
    <script type="module">
      const base = ${JSON.stringify(apiBaseUrl)};
      const userId = "user_ada";
      const token = localStorage.getItem("openvitals.token") || "ov_demo_user_ada_derived";

      const byId = (id) => document.getElementById(id);
      const asList = (value) => Array.isArray(value) ? value : [];
      const escapeHtml = (value) => String(value ?? "unknown").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[char] || char);
      const formatDate = (value) => value ? new Date(value).toLocaleString() : "never";
      const formatHours = (value) => typeof value === "number" ? (value < 1 ? "<1h" : value.toFixed(value < 10 ? 1 : 0) + "h") : "unknown";
      const percent = (value) => typeof value === "number" ? Math.round(value * 100) + "%" : "unknown";
      const qualityClass = (value) => ["ok", "stale", "missing"].includes(value) ? value : "unknown";
      const tag = (label, value, className = "") => '<span class="tag ' + className + '">' + escapeHtml(label) + ': ' + escapeHtml(value) + '</span>';
      const qualityTag = (gate) => tag("quality", gate || "unknown", "quality-" + qualityClass(gate));
      const optionalTag = (label, value) => value == null ? "" : tag(label, value);
      const empty = (message) => '<div class="empty">' + escapeHtml(message) + '</div>';

      const fetchJson = async (path) => {
        const res = await fetch(new URL(path, base).toString(), {
          headers: {
            authorization: "Bearer " + token
          }
        });
        if (!res.ok) {
          throw new Error("API " + res.status + " while loading " + path);
        }
        return res.json();
      };

      const renderDashboard = (state) => {
        const connectors = state.connectors ?? { sourceAccounts: [] };
        const scores = asList(state.scores);
        const alerts = asList(state.alerts);
        const syncSources = asList(state.syncStatus?.sources);
        const syncByProvider = new Map(syncSources.map((source) => [source.providerId, source]));
        const okSources = syncSources.filter((source) => source.dataQualityGate === "ok").length;

        byId("connectors").textContent = asList(connectors.sourceAccounts).length;
        byId("scores").textContent = scores.length;
        byId("alerts").textContent = alerts.length;
        byId("quality").textContent = syncSources.length ? okSources + "/" + syncSources.length : "0";

        byId("connector-list").innerHTML = asList(connectors.sourceAccounts).map((account) => {
          const sync = syncByProvider.get(account.providerId) ?? account;
          return '<div class="row">'
            + '<strong>' + escapeHtml(account.providerId) + '</strong>'
            + '<div class="detail">'
            + tag("status", account.status)
            + tag("auth", account.authState ?? sync.authState ?? "unknown")
            + tag("mode", account.dataMode ?? sync.dataMode ?? "unknown")
            + tag("method", account.connectionMethod ?? sync.connectionMethod ?? "unknown")
            + '</div>'
            + '<div class="detail">last sync ' + escapeHtml(formatDate(account.lastSyncAt ?? sync.lastSyncAt)) + ' · freshness ' + escapeHtml(formatHours(sync.syncFreshnessHours)) + '</div>'
            + '</div>';
        }).join("") || empty("No connectors returned by the API.");

        byId("quality-list").innerHTML = syncSources.map((source) => {
          return '<div class="row">'
            + '<strong>' + escapeHtml(source.providerId) + '</strong>'
            + '<div class="detail">'
            + qualityTag(source.dataQualityGate)
            + tag("freshness", formatHours(source.syncFreshnessHours))
            + tag("mode", source.dataMode ?? "unknown")
            + tag("method", source.connectionMethod ?? "unknown")
            + optionalTag("reason", source.stalenessReason)
            + optionalTag("queue", source.queueDepth)
            + '</div>'
            + '</div>';
        }).join("") || empty("Sync status did not include source quality rows.");

        byId("score-list").innerHTML = scores.map((score) => {
          return '<div class="row">'
            + '<strong>' + escapeHtml(score.scoreKind) + '</strong> · ' + escapeHtml(score.value) + ' · ' + escapeHtml(score.label)
            + '<div class="detail">'
            + tag("confidence", percent(score.confidence))
            + tag("freshness", formatHours(score.freshnessHours))
            + optionalTag("granularity", score.dataGranularity)
            + optionalTag("latency", score.latencyClass)
            + optionalTag("source", score.source)
            + optionalTag("capture", score.captureMode)
            + tag("missing", asList(score.missingSignals).length)
            + '</div>'
            + '</div>';
        }).join("") || empty("No scores returned by the API.");

        byId("alert-list").innerHTML = alerts.map((alert) => {
          return '<div class="row ' + (alert.severity === "high" ? "alert-high" : "") + '">'
            + '<strong>' + escapeHtml(alert.workflowKind) + '</strong> · ' + escapeHtml(alert.title)
            + '<div class="detail">'
            + tag("severity", alert.severity)
            + tag("confidence", percent(alert.confidence))
            + tag("freshness", formatHours(alert.freshnessHours))
            + optionalTag("source", alert.source)
            + optionalTag("capture", alert.captureMode)
            + '</div>'
            + '</div>';
        }).join("") || empty("No open alerts returned by the API.");

        byId("explain").textContent = JSON.stringify(state.explain, null, 2);
        byId("runs").textContent = JSON.stringify(
          {
            runtimeMode: state.runtimeMode,
            collectorType: state.collectorType,
            syncStatus: state.syncStatus,
            automationRuns: state.automationRuns
          },
          null,
          2
        );
      };

      try {
        renderDashboard(await fetchJson("/v1/dashboard/state?userId=" + encodeURIComponent(userId)));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ["connector-list", "quality-list", "score-list", "alert-list"].forEach((id) => {
          byId(id).innerHTML = '<div class="error">' + escapeHtml(message) + '</div>';
        });
        byId("explain").textContent = message;
        byId("runs").textContent = message;
      }
    </script>
  </body>
</html>`;
