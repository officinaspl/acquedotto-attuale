<?php
/**
 * Configurazione dashboard temperatura ESP32 DS18B20.
 *
 * Override sul server: crea config.local.php con es. define('INGEST_KEY', 'segreto');
 * Il file locale viene caricato prima dei default.
 */

if (is_readable(__DIR__ . '/config.local.php')) {
    require __DIR__ . '/config.local.php';
}

// Chiave ingest opzionale. Se stringa vuota → compatibilità legacy (nessun controllo).
// Con chiave impostata: ?key=... oppure header X-Ingest-Key.
if (!defined('INGEST_KEY')) {
    define('INGEST_KEY', '');
}

if (!defined('APP_TIMEZONE')) {
    define('APP_TIMEZONE', 'Europe/Rome');
}

// File storico (formato legacy: d/m/Y|H:i:s|temp|rssi)
if (!defined('STORICO_FILE')) {
    define('STORICO_FILE', __DIR__ . '/storico_temperature.txt');
}

// Validazione temperatura (°C) — range tipico DS18B20 operativo
if (!defined('TEMP_MIN')) {
    define('TEMP_MIN', -55.0);
}
if (!defined('TEMP_MAX')) {
    define('TEMP_MAX', 125.0);
}

// Validazione RSSI WiFi (dBm)
if (!defined('RSSI_MIN')) {
    define('RSSI_MIN', -120);
}
if (!defined('RSSI_MAX')) {
    define('RSSI_MAX', 0);
}

if (!defined('TABLE_PAGE_SIZE')) {
    define('TABLE_PAGE_SIZE', 40);
}

if (!defined('CHART_MAX_POINTS')) {
    define('CHART_MAX_POINTS', 180);
}

if (!defined('UI_REFRESH_SEC')) {
    define('UI_REFRESH_SEC', 60);
}

if (!defined('DASHBOARD_TITLE')) {
    define('DASHBOARD_TITLE', 'Temperatura ESP32 · DS18B20');
}
