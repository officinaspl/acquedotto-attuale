@echo off
:: Tasto destro -> Esegui come amministratore
:: Rimuove porte COM fantasma (Arduino/MKR/CH340 non collegati)
setlocal

net session >nul 2>&1
if errorlevel 1 (
  echo [ERRORE] Serve "Esegui come amministratore".
  pause
  exit /b 1
)

echo.
echo === Pulizia porte COM fantasma ===
echo.

powershell -NoProfile -Command ^
  "$devs = Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { ($_.Class -eq 'Ports' -or $_.FriendlyName -match 'COM\d+') -and $_.Status -ne 'OK' };" ^
  "if (-not $devs) { Write-Host 'Nessuna porta fantasma trovata.' } else { foreach ($d in $devs) { Write-Host ('Rimuovo fantasma: ' + $d.FriendlyName); pnputil /remove-device $d.InstanceId } }"

echo.
echo Stacca TUTTE le schede USB Arduino/NodeMCU.
echo Attendi 10 secondi.
echo Collega SOLO la NodeMCU V3.
echo Poi premi un tasto...
pause >nul

pnputil /scan-devices
timeout /t 3 >nul

echo.
echo Porte attive:
powershell -NoProfile -Command "Get-PnpDevice -Class Ports -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'OK' } | Select-Object FriendlyName, Status | Format-Table -AutoSize"

echo.
echo In Arduino IDE: Porta = COM della CH340, Upload Speed = 115200
echo Chiudi Monitor Seriale prima di Carica.
pause
