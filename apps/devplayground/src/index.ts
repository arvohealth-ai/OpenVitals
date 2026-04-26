export const renderDevPlaygroundPage = (apiBaseUrl: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenVitals Playground</title>
    <style>
      :root {
        --bg: #fcfbf6;
        --ink: #14231d;
        --muted: #5d6b64;
        --accent: #bd5d1b;
        --accent-soft: rgba(189, 93, 27, 0.14);
        --panel: #ffffff;
        --border: rgba(20, 35, 29, 0.08);
        --ok: #0f766e;
        --warn: #9a5a00;
        --bad: #9f2d2d;
      }
      body {
        margin: 0;
        background:
          linear-gradient(180deg, rgba(189,93,27,0.08), transparent 30%),
          linear-gradient(135deg, #faf4e8, var(--bg));
        color: var(--ink);
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      }
      main {
        width: min(1100px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 28px 0 44px;
      }
      h1 {
        margin: 0 0 10px;
        font-size: clamp(2rem, 6vw, 4rem);
      }
      .controls {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin: 18px 0;
      }
      button {
        border: 0;
        border-radius: 999px;
        padding: 12px 18px;
        background: var(--accent);
        color: white;
        font-weight: 700;
        cursor: pointer;
      }
      pre,
      .summary {
        overflow: auto;
        padding: 18px;
        border-radius: 20px;
        background: var(--panel);
        box-shadow: 0 16px 32px rgba(20, 35, 29, 0.08);
        border: 1px solid var(--border);
      }
      pre { min-height: 420px; }
      .summary {
        display: grid;
        gap: 10px;
        margin-bottom: 14px;
        color: var(--muted);
      }
      .tag,
      .chip {
        display: inline-block;
        padding: 6px 10px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 12px;
        font-weight: 700;
      }
      .chip { margin: 0 6px 6px 0; }
      .quality-ok { background: rgba(15, 118, 110, 0.12); color: var(--ok); }
      .quality-stale { background: rgba(154, 90, 0, 0.12); color: var(--warn); }
      .quality-missing,
      .quality-unknown { background: rgba(159, 45, 45, 0.12); color: var(--bad); }
    </style>
  </head>
  <body>
    <main>
      <span class="tag">Developer Playground</span>
      <h1>Probe Every Surface</h1>
      <p>Use this page to hit the demo API, inspect explainability payloads, and validate freshness, confidence, and quality gates before wiring another runtime.</p>
      <div class="controls">
        <button data-path="/v1/dashboard/state?userId=user_ada">dashboard state</button>
        <button data-path="/v1/connectors?userId=user_ada">connectors</button>
        <button data-path="/v1/users/user_ada/sync-status">sync status</button>
        <button data-path="/v1/timeline?userId=user_ada&days=7">timeline</button>
        <button data-path="/v1/scores?userId=user_ada">scores</button>
        <button data-path="/v1/alerts?userId=user_ada">alerts</button>
        <button data-path="/v1/export/omh?userId=user_ada">omh export</button>
        <button data-path="/v1/export/fhir?userId=user_ada">fhir export</button>
      </div>
      <section id="summary" class="summary">Quality summary appears after a request.</section>
      <pre id="output">Select an endpoint.</pre>
    </main>
    <script type="module">
      const base = ${JSON.stringify(apiBaseUrl)};
      const token = localStorage.getItem("openvitals.token") || "ov_demo_user_ada_derived";
      const output = document.getElementById("output");
      const summary = document.getElementById("summary");
      const asList = (value) => Array.isArray(value) ? value : [];
      const escapeHtml = (value) => String(value ?? "unknown").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[char] || char);
      const formatHours = (value) => typeof value === "number" ? (value < 1 ? "<1h" : value.toFixed(value < 10 ? 1 : 0) + "h") : "unknown";
      const percent = (value) => typeof value === "number" ? Math.round(value * 100) + "%" : "unknown";
      const qualityClass = (value) => ["ok", "stale", "missing"].includes(value) ? value : "unknown";
      const chip = (label, value, className = "") => '<span class="chip ' + className + '">' + escapeHtml(label) + ': ' + escapeHtml(value) + '</span>';

      const qualitySummary = (payload) => {
        const syncSources = asList(payload.sources).concat(asList(payload.syncStatus?.sources));
        const connectorSources = asList(payload.sourceAccounts).concat(asList(payload.connectors?.sourceAccounts));
        const scores = asList(payload.scores).concat(Array.isArray(payload) ? payload.filter((row) => row && row.scoreKind) : []);
        const sourceRows = syncSources.length ? syncSources : connectorSources;
        const parts = [];

        if (sourceRows.length) {
          parts.push('<strong>Sources</strong><div>' + sourceRows.map((source) => {
            const gate = source.dataQualityGate ?? source.status ?? "unknown";
            return chip(source.providerId ?? "source", gate, "quality-" + qualityClass(gate))
              + chip("freshness", formatHours(source.syncFreshnessHours))
              + chip("mode", source.dataMode ?? "unknown")
              + chip("method", source.connectionMethod ?? "unknown");
          }).join("</div><div>") + '</div>');
        }

        if (scores.length) {
          parts.push('<strong>Scores</strong><div>' + scores.map((score) => {
            return chip(score.scoreKind ?? "score", score.value ?? "unknown")
              + chip("confidence", percent(score.confidence))
              + chip("freshness", formatHours(score.freshnessHours))
              + (score.dataGranularity ? chip("granularity", score.dataGranularity) : "")
              + (score.latencyClass ? chip("latency", score.latencyClass) : "");
          }).join("</div><div>") + '</div>');
        }

        return parts.join("") || "No quality, freshness, or confidence fields found in this payload.";
      };

      document.querySelectorAll("button").forEach((button) => {
        button.addEventListener("click", async () => {
          output.textContent = "Loading " + button.dataset.path + "...";
          summary.textContent = "Loading quality summary...";
          try {
            const response = await fetch(new URL(button.dataset.path, base).toString(), {
              headers: {
                authorization: "Bearer " + token
              }
            });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error("API " + response.status + ": " + JSON.stringify(payload));
            }
            summary.innerHTML = qualitySummary(payload);
            output.textContent = JSON.stringify(payload, null, 2);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            summary.innerHTML = '<span class="chip quality-missing">error: ' + escapeHtml(message) + '</span>';
            output.textContent = message;
          }
        });
      });
    </script>
  </body>
</html>`;
