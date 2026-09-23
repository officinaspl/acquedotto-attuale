/**
 * Refresh intelligente + grafico Chart.js (dati da JSON inline / API).
 */
(function () {
  "use strict";

  var cfg = window.DASH || { refreshSec: 60, apiUrl: "?api=1", page: 1 };
  var countdownEl = document.getElementById("countdown");
  var chart = null;
  var remaining = cfg.refreshSec;

  function parseChartData() {
    var el = document.getElementById("chart-data");
    if (!el) return [];
    try {
      return JSON.parse(el.textContent || "[]");
    } catch (e) {
      return [];
    }
  }

  function buildChart(points) {
    var canvas = document.getElementById("temp-chart");
    var empty = document.getElementById("chart-empty");
    if (!canvas || typeof Chart === "undefined") return;

    var labels = points.map(function (p) { return p.t; });
    var values = points.map(function (p) { return p.y; });

    if (empty) {
      empty.classList.toggle("hidden", points.length > 0);
    }

    if (chart) {
      chart.data.labels = labels;
      chart.data.datasets[0].data = values;
      chart.update("none");
      return;
    }

    chart = new Chart(canvas, {
      type: "line",
      data: {
        labels: labels,
        datasets: [{
          label: "°C",
          data: values,
          borderColor: "#f59e0b",
          backgroundColor: "rgba(245, 158, 11, 0.12)",
          borderWidth: 2,
          pointRadius: points.length > 80 ? 0 : 2,
          pointHoverRadius: 4,
          pointBackgroundColor: "#fbbf24",
          fill: true,
          tension: 0.15
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(11, 15, 20, 0.95)",
            borderColor: "rgba(148, 163, 184, 0.3)",
            borderWidth: 1,
            titleFont: { family: "IBM Plex Mono, monospace", size: 11 },
            bodyFont: { family: "IBM Plex Mono, monospace", size: 12 },
            callbacks: {
              label: function (ctx) {
                return " " + Number(ctx.parsed.y).toFixed(2) + " °C";
              }
            }
          }
        },
        scales: {
          x: {
            ticks: {
              maxTicksLimit: 8,
              color: "#94a3b8",
              font: { family: "IBM Plex Mono, monospace", size: 10 },
              callback: function (val, idx) {
                var lab = this.getLabelForValue(val);
                if (!lab) return "";
                // Mostra solo orario se possibile
                var parts = String(lab).split(" ");
                return parts.length > 1 ? parts[1] : lab;
              }
            },
            grid: { color: "rgba(148, 163, 184, 0.08)" }
          },
          y: {
            ticks: {
              color: "#94a3b8",
              font: { family: "IBM Plex Mono, monospace", size: 10 },
              callback: function (v) { return v + "°"; }
            },
            grid: { color: "rgba(45, 212, 191, 0.08)" }
          }
        }
      }
    });
  }

  function fmtTemp(v) {
    if (v === null || typeof v === "undefined") return "—";
    return Number(v).toFixed(2).replace(".", ",") + " °C";
  }

  function applyPayload(data) {
    if (!data) return;

    var statusMap = {
      live: ["LIVE", "status-live"],
      stale: ["RITARDATO", "status-stale"],
      offline: ["OFFLINE", "status-offline"]
    };
    var st = statusMap[data.status] || statusMap.offline;
    var pill = document.getElementById("status-pill");
    if (pill) {
      pill.className = "status-pill " + st[1];
      pill.innerHTML = '<span class="pulse"></span>' + st[0];
    }

    var clock = document.getElementById("clock-chip");
    if (clock) {
      clock.textContent = data.generated_at + " · " + data.timezone;
    }

    var latest = data.latest;
    var tempEl = document.getElementById("metric-temp");
    if (tempEl) tempEl.textContent = fmtTemp(latest ? latest.temp : null);

    var lastEl = document.getElementById("metric-last");
    if (lastEl) {
      lastEl.textContent = latest ? ("ultimo campione " + latest.label) : "nessun campione";
    }

    var mm = document.getElementById("metric-minmax");
    if (mm && data.stats) {
      mm.innerHTML = fmtTemp(data.stats.min) + ' <span class="sep">/</span> ' + fmtTemp(data.stats.max);
    }

    var avg = document.getElementById("metric-avg");
    if (avg && data.stats) avg.textContent = fmtTemp(data.stats.avg);

    var count = document.getElementById("metric-count");
    if (count && data.stats) count.textContent = data.stats.count + " campioni";

    if (data.rssi) {
      var badge = document.getElementById("rssi-badge");
      if (badge) {
        badge.className = "rssi-badge " + data.rssi.class;
        badge.textContent = data.rssi.label;
      }
      var hint = document.getElementById("rssi-hint");
      if (hint) hint.textContent = data.rssi.hint;
    }

    if (data.chart) {
      var raw = document.getElementById("chart-data");
      if (raw) raw.textContent = JSON.stringify(data.chart);
      buildChart(data.chart);
      var ch = document.getElementById("chart-hint");
      if (ch) {
        ch.textContent = data.chart.length + " punti · " + data.timezone;
      }
    }

    // Tabella: solo pagina 1 via API (ultime N); altre pagine restano server-side
    if (cfg.page === 1 && data.table && Array.isArray(data.table)) {
      var tbody = document.getElementById("table-body");
      if (tbody) {
        if (!data.table.length) {
          tbody.innerHTML = '<tr><td colspan="4" class="empty">Nessuna misura registrata</td></tr>';
        } else {
          tbody.innerHTML = data.table.map(function (row) {
            var rssi = row.rssi === null || typeof row.rssi === "undefined"
              ? "—"
              : row.rssi + " dBm";
            var q = row._q || guessRssi(row.rssi);
            return (
              "<tr>" +
              '<td class="mono">' + esc(row.label) + "</td>" +
              '<td class="mono temp-cell">' + Number(row.temp).toFixed(2).replace(".", ",") + " °C</td>" +
              '<td class="mono">' + esc(rssi) + "</td>" +
              '<td><span class="rssi-badge sm ' + esc(q.class) + '">' + esc(q.label) + "</span></td>" +
              "</tr>"
            );
          }).join("");
        }
      }
    }
  }

  function guessRssi(rssi) {
    if (rssi === null || typeof rssi === "undefined") {
      return { label: "N/D", class: "q-unknown" };
    }
    if (rssi >= -55) return { label: "Eccellente", class: "q-excellent" };
    if (rssi >= -70) return { label: "Buono", class: "q-good" };
    if (rssi >= -85) return { label: "Debole", class: "q-weak" };
    return { label: "Critico", class: "q-critical" };
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function refreshFromApi() {
    var url = cfg.apiUrl;
    fetch(url, { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        applyPayload(data);
        remaining = cfg.refreshSec;
        if (countdownEl) countdownEl.textContent = String(remaining);
      })
      .catch(function () {
        // fallback silenzioso: riprova al prossimo tick
      });
  }

  function tick() {
    remaining -= 1;
    if (remaining <= 0) {
      remaining = cfg.refreshSec;
      refreshFromApi();
    }
    if (countdownEl) countdownEl.textContent = String(remaining);
  }

  document.addEventListener("DOMContentLoaded", function () {
    buildChart(parseChartData());

    var btn = document.getElementById("btn-refresh");
    if (btn) {
      btn.addEventListener("click", function () {
        remaining = cfg.refreshSec;
        refreshFromApi();
      });
    }

    setInterval(tick, 1000);
  });
})();
