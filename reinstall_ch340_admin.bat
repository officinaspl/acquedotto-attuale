@echo off
:: Tasto destro -> Esegui come amministratore
setlocal

net session >nul 2>&1
if errorlevel 1 (
  echo [ERRORE] Serve "Esegui come amministratore".
  pause
  exit /b 1
)

echo.
echo === Reinstallazione driver CH340 (NodeMCU) ===
echo.

powershell -NoProfile -Command ^
  "$devs = Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -like '*CH340*' };" ^
  "if (-not $devs) { Write-Host 'Nessun CH340 trovato.'; exit 1 };" ^
  "foreach ($d in $devs) { Write-Host ('Rimuovo: ' + $d.FriendlyName); pnputil /remove-device $d.InstanceId }"

echo.
echo Stacca la NodeMCU USB, attendi 5 secondi, ricollega.
echo Poi premi un tasto per analizzare i dispositivi...
pause >nul

pnputil /scan-devices

echo.
echo Porte seriali attuali:
powershell -NoProfile -Command "Get-PnpDevice -Class Ports -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match 'CH340|CP210|USB' } | Select-Object FriendlyName, Status | Format-Table -AutoSize"

echo.
echo Fatto. Apri Arduino IDE, scegli la nuova COM e carica con velocita 115200.
pause
