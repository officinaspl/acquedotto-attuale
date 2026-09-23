<?php
/**
 * Dashboard + ingest temperatura ESP32 DS18B20.
 * Protocollo ESP invariato: GET ?temp=<float> [&rssi=<int>] → risposta "OK".
 */

declare(strict_types=1);

require __DIR__ . '/config.php';

date_default_timezone_set(APP_TIMEZONE);

// ---------------------------------------------------------------------------
// Ingest (priorità assoluta: risposta minima, exit immediato)
// ---------------------------------------------------------------------------
if (isset($_GET['temp'])) {
    handleIngest();
    exit;
}

// Endpoint JSON leggero per refresh parziale
if (isset($_GET['api']) && $_GET['api'] === '1') {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode(buildDashboardPayload(), JSON_UNESCAPED_UNICODE);
    exit;
}

// Dashboard HTML
$page = max(1, (int) ($_GET['page'] ?? 1));
$payload = buildDashboardPayload($page);
renderDashboard($payload, $page);

// ===========================================================================
// Funzioni
// ===========================================================================

function handleIngest(): void
{
    // Autenticazione opzionale: se INGEST_KEY è vuota, comportamento legacy
    $configuredKey = (string) INGEST_KEY;
    if ($configuredKey !== '') {
        $provided = '';
        if (isset($_GET['key'])) {
            $provided = (string) $_GET['key'];
        } elseif (!empty($_SERVER['HTTP_X_INGEST_KEY'])) {
            $provided = (string) $_SERVER['HTTP_X_INGEST_KEY'];
        }
        if (!hash_equals($configuredKey, $provided)) {
            http_response_code(403);
            header('Content-Type: text/plain; charset=utf-8');
            echo 'FORBIDDEN';
            exit;
        }
    }

    $rawTemp = trim((string) $_GET['temp']);
    if ($rawTemp === '' || !is_numeric($rawTemp)) {
        http_response_code(400);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'BAD_TEMP';
        exit;
    }

    $temp = (float) $rawTemp;
    if ($temp < TEMP_MIN || $temp > TEMP_MAX || !is_finite($temp)) {
        http_response_code(400);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'TEMP_RANGE';
        exit;
    }

    $rssi = null;
    if (isset($_GET['rssi']) && $_GET['rssi'] !== '') {
        $rawRssi = trim((string) $_GET['rssi']);
        if (!is_numeric($rawRssi) || strpos($rawRssi, '.') !== false) {
            http_response_code(400);
            header('Content-Type: text/plain; charset=utf-8');
            echo 'BAD_RSSI';
            exit;
        }
        $rssi = (int) $rawRssi;
        if ($rssi < RSSI_MIN || $rssi > RSSI_MAX) {
            http_response_code(400);
            header('Content-Type: text/plain; charset=utf-8');
            echo 'RSSI_RANGE';
            exit;
        }
    }

    $now = new DateTimeImmutable('now');
    // Due decimali fissi: leggibile e compatibile col parser storico
    $tempStr = sprintf('%.2f', $temp);
    $line = sprintf(
        "%s|%s|%s|%s\n",
        $now->format('d/m/Y'),
        $now->format('H:i:s'),
        $tempStr,
        $rssi === null ? '' : (string) $rssi
    );

    // Append atomico-ish con lock
    $file = STORICO_FILE;
    $dir = dirname($file);
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }

    $fp = @fopen($file, 'ab');
    if ($fp === false) {
        http_response_code(500);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'WRITE_ERR';
        exit;
    }
    flock($fp, LOCK_EX);
    fwrite($fp, $line);
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);

    header('Content-Type: text/plain; charset=utf-8');
    echo 'OK';
    exit;
}

/**
 * Legge lo storico: parse rigoroso, ignora righe vuote/corrotte.
 * Restituisce array di record dal più vecchio al più recente.
 *
 * @return list<array{ts:int,label:string,temp:float,rssi:?int}>
 */
function loadRecords(): array
{
    $file = STORICO_FILE;
    if (!is_readable($file)) {
        return [];
    }

    $raw = file($file, FILE_IGNORE_NEW_LINES);
    if ($raw === false) {
        return [];
    }

    $out = [];
    foreach ($raw as $line) {
        $line = trim($line);
        if ($line === '') {
            continue;
        }
        $parts = explode('|', $line);
        if (count($parts) < 3) {
            continue;
        }
        $date = trim($parts[0]);
        $time = trim($parts[1]);
        $tempStr = trim($parts[2]);
        $rssiStr = isset($parts[3]) ? trim($parts[3]) : '';

        if ($tempStr === '' || !is_numeric($tempStr)) {
            continue;
        }
        $temp = (float) $tempStr;
        if (!is_finite($temp)) {
            continue;
        }

        $dt = DateTimeImmutable::createFromFormat('d/m/Y H:i:s', $date . ' ' . $time);
        if ($dt === false) {
            continue;
        }

        $rssi = null;
        if ($rssiStr !== '' && is_numeric($rssiStr)) {
            $rssi = (int) $rssiStr;
        }

        $out[] = [
            'ts' => $dt->getTimestamp(),
            'label' => $dt->format('d/m/Y H:i:s'),
            'temp' => $temp,
            'rssi' => $rssi,
        ];
    }

    return $out;
}

/**
 * Sottocampiona per il grafico mantenendo primo/ultimo e estremi locali grezzi.
 *
 * @param list<array{ts:int,label:string,temp:float,rssi:?int}> $records
 * @return list<array{t:string,y:float}>
 */
function downsampleForChart(array $records, int $maxPoints): array
{
    $n = count($records);
    if ($n === 0) {
        return [];
    }
    if ($n <= $maxPoints) {
        $pts = [];
        foreach ($records as $r) {
            $pts[] = ['t' => $r['label'], 'y' => round($r['temp'], 2)];
        }
        return $pts;
    }

    $step = ($n - 1) / ($maxPoints - 1);
    $pts = [];
    $used = [];
    for ($i = 0; $i < $maxPoints; $i++) {
        $idx = (int) round($i * $step);
        if (isset($used[$idx])) {
            continue;
        }
        $used[$idx] = true;
        $r = $records[$idx];
        $pts[] = ['t' => $r['label'], 'y' => round($r['temp'], 2)];
    }
    return $pts;
}

function rssiQuality(?int $rssi): array
{
    if ($rssi === null) {
        return ['label' => 'N/D', 'class' => 'q-unknown', 'hint' => 'RSSI non inviato'];
    }
    if ($rssi >= -55) {
        return ['label' => 'Eccellente', 'class' => 'q-excellent', 'hint' => (string) $rssi . ' dBm'];
    }
    if ($rssi >= -70) {
        return ['label' => 'Buono', 'class' => 'q-good', 'hint' => (string) $rssi . ' dBm'];
    }
    if ($rssi >= -85) {
        return ['label' => 'Debole', 'class' => 'q-weak', 'hint' => (string) $rssi . ' dBm'];
    }
    return ['label' => 'Critico', 'class' => 'q-critical', 'hint' => (string) $rssi . ' dBm'];
}

function buildDashboardPayload(int $page = 1): array
{
    $records = loadRecords();
    $total = count($records);
    $pageSize = TABLE_PAGE_SIZE;
    $pages = max(1, (int) ceil($total / $pageSize));
    $page = min(max(1, $page), $pages);

    $latest = $total > 0 ? $records[$total - 1] : null;
    $temps = array_column($records, 'temp');

    $min = $temps ? min($temps) : null;
    $max = $temps ? max($temps) : null;
    $avg = $temps ? array_sum($temps) / count($temps) : null;

    // Ultimi N per tabella (ordine recente → vecchio)
    $reversed = array_reverse($records);
    $offset = ($page - 1) * $pageSize;
    $tableSlice = array_slice($reversed, $offset, $pageSize);

    $ageSec = null;
    $status = 'offline';
    if ($latest !== null) {
        $ageSec = time() - $latest['ts'];
        if ($ageSec <= 120) {
            $status = 'live';
        } elseif ($ageSec <= 600) {
            $status = 'stale';
        } else {
            $status = 'offline';
        }
    }

    $rssiInfo = rssiQuality($latest['rssi'] ?? null);

    return [
        'generated_at' => (new DateTimeImmutable('now'))->format('d/m/Y H:i:s'),
        'timezone' => APP_TIMEZONE,
        'refresh_sec' => UI_REFRESH_SEC,
        'status' => $status,
        'age_sec' => $ageSec,
        'latest' => $latest,
        'rssi' => $rssiInfo,
        'stats' => [
            'count' => $total,
            'min' => $min !== null ? round($min, 2) : null,
            'max' => $max !== null ? round($max, 2) : null,
            'avg' => $avg !== null ? round($avg, 2) : null,
        ],
        'chart' => downsampleForChart($records, CHART_MAX_POINTS),
        'table' => $tableSlice,
        'pagination' => [
            'page' => $page,
            'pages' => $pages,
            'page_size' => $pageSize,
            'total' => $total,
        ],
    ];
}

function h(?string $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function fmtTemp(?float $t): string
{
    if ($t === null) {
        return '—';
    }
    return number_format($t, 2, ',', '') . ' °C';
}

function renderDashboard(array $p, int $page): void
{
    $title = DASHBOARD_TITLE;
    $latest = $p['latest'];
    $stats = $p['stats'];
    $rssi = $p['rssi'];
    $statusMap = [
        'live' => ['LIVE', 'status-live'],
        'stale' => ['RITARDATO', 'status-stale'],
        'offline' => ['OFFLINE', 'status-offline'],
    ];
    [$statusLabel, $statusClass] = $statusMap[$p['status']] ?? $statusMap['offline'];
    $chartJson = json_encode($p['chart'], JSON_UNESCAPED_UNICODE);
    $refresh = (int) $p['refresh_sec'];
    $pag = $p['pagination'];

    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    ?>
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title><?= h($title) ?></title>
  <link rel="stylesheet" href="assets/dashboard.css">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js" defer></script>
  <script src="assets/dashboard.js" defer></script>
</head>
<body>
  <div class="scanlines" aria-hidden="true"></div>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"></span>
        <div>
          <p class="eyebrow">CONTROL ROOM · ACQUEDOTTO</p>
          <h1><?= h($title) ?></h1>
        </div>
      </div>
      <div class="topbar-meta">
        <span class="status-pill <?= h($statusClass) ?>" id="status-pill">
          <span class="pulse"></span><?= h($statusLabel) ?>
        </span>
        <span class="meta-chip mono" id="clock-chip"><?= h($p['generated_at']) ?> · <?= h($p['timezone']) ?></span>
        <span class="meta-chip mono" id="countdown-chip">refresh <span id="countdown"><?= $refresh ?></span>s</span>
        <button type="button" class="btn-ghost" id="btn-refresh" title="Aggiorna ora">Aggiorna</button>
      </div>
    </header>

    <section class="metrics" aria-label="Metriche principali">
      <article class="metric metric-temp">
        <p class="metric-label">Temperatura attuale</p>
        <p class="metric-value mono" id="metric-temp"><?= h(fmtTemp($latest['temp'] ?? null)) ?></p>
        <p class="metric-sub mono" id="metric-last">
          <?= $latest ? 'ultimo campione ' . h($latest['label']) : 'nessun campione' ?>
        </p>
      </article>
      <article class="metric">
        <p class="metric-label">Min / Max</p>
        <p class="metric-value mono compact" id="metric-minmax">
          <?= h(fmtTemp($stats['min'])) ?>
          <span class="sep">/</span>
          <?= h(fmtTemp($stats['max'])) ?>
        </p>
        <p class="metric-sub">su tutto lo storico</p>
      </article>
      <article class="metric">
        <p class="metric-label">Media</p>
        <p class="metric-value mono" id="metric-avg"><?= h(fmtTemp($stats['avg'])) ?></p>
        <p class="metric-sub mono" id="metric-count"><?= (int) $stats['count'] ?> campioni</p>
      </article>
      <article class="metric">
        <p class="metric-label">Qualità segnale</p>
        <p class="metric-value">
          <span class="rssi-badge <?= h($rssi['class']) ?>" id="rssi-badge"><?= h($rssi['label']) ?></span>
        </p>
        <p class="metric-sub mono" id="rssi-hint"><?= h($rssi['hint']) ?></p>
      </article>
    </section>

    <section class="panel chart-panel">
      <div class="panel-head">
        <h2>Andamento temperatura</h2>
        <p class="panel-hint mono" id="chart-hint">
          <?= count($p['chart']) ?> punti · max <?= (int) CHART_MAX_POINTS ?> · <?= h($p['timezone']) ?>
        </p>
      </div>
      <div class="chart-wrap">
        <canvas id="temp-chart" height="120" aria-label="Grafico temperatura"></canvas>
        <p class="chart-empty<?= count($p['chart']) ? ' hidden' : '' ?>" id="chart-empty">Nessun dato da tracciare</p>
      </div>
    </section>

    <section class="panel table-panel">
      <div class="panel-head">
        <h2>Ultimi campioni</h2>
        <p class="panel-hint mono">
          pagina <?= (int) $pag['page'] ?>/<?= (int) $pag['pages'] ?>
          · <?= (int) $pag['page_size'] ?>/pagina
          · totale <?= (int) $pag['total'] ?>
        </p>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Timestamp</th>
              <th scope="col">Temperatura</th>
              <th scope="col">RSSI</th>
              <th scope="col">Qualità</th>
            </tr>
          </thead>
          <tbody id="table-body">
          <?php if (!$p['table']): ?>
            <tr><td colspan="4" class="empty">Nessuna misura registrata</td></tr>
          <?php else: ?>
            <?php foreach ($p['table'] as $row):
                $q = rssiQuality($row['rssi']);
            ?>
            <tr>
              <td class="mono"><?= h($row['label']) ?></td>
              <td class="mono temp-cell"><?= h(number_format($row['temp'], 2, ',', '')) ?> °C</td>
              <td class="mono"><?= $row['rssi'] === null ? '—' : h((string) $row['rssi']) . ' dBm' ?></td>
              <td><span class="rssi-badge sm <?= h($q['class']) ?>"><?= h($q['label']) ?></span></td>
            </tr>
            <?php endforeach; ?>
          <?php endif; ?>
          </tbody>
        </table>
      </div>
      <?php if ($pag['pages'] > 1): ?>
      <nav class="pager" aria-label="Paginazione">
        <?php if ($page > 1): ?>
          <a class="btn-ghost" href="?page=<?= $page - 1 ?>">← Precedente</a>
        <?php endif; ?>
        <?php if ($page < $pag['pages']): ?>
          <a class="btn-ghost" href="?page=<?= $page + 1 ?>">Successiva →</a>
        <?php endif; ?>
      </nav>
      <?php endif; ?>
    </section>

    <footer class="foot mono">
      Ingest: <code>?temp=&lt;float&gt;&amp;rssi=&lt;int&gt;</code>
      · storico <code>storico_temperature.txt</code>
      · refresh intelligente via <code>?api=1</code>
    </footer>
  </div>

  <script type="application/json" id="chart-data"><?= $chartJson !== false ? $chartJson : '[]' ?></script>
  <script>
    window.DASH = {
      refreshSec: <?= $refresh ?>,
      apiUrl: <?= json_encode('?api=1', JSON_UNESCAPED_UNICODE) ?>,
      page: <?= (int) $page ?>
    };
  </script>
</body>
</html>
    <?php
}
