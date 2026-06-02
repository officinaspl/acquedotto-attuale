@echo off
setlocal

set GIT="C:\Program Files\Git\cmd\git.exe"
set PROJ="C:\Users\Stefano\Desktop\acquedotto attuale"

cd /d %PROJ%
set MSG=Auto backup %date% %time%

%GIT% add .
if errorlevel 1 goto :err

%GIT% diff --cached --quiet
if not errorlevel 1 (
  echo.
  echo [INFO] Nessuna modifica da salvare.
  pause
  exit /b 0
)

%GIT% commit -m "%MSG%"
if errorlevel 1 goto :err

%GIT% push
if errorlevel 1 goto :err

echo.
echo Commit: %MSG%
echo [OK] Commit e push completati con successo.
pause
exit /b 0

:err
echo.
echo [ERRORE] Operazione non completata. Controlla i messaggi sopra.
pause
exit /b 1
