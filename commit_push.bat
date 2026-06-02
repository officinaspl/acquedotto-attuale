@echo off
setlocal

set GIT="C:\Program Files\Git\cmd\git.exe"
set PROJ="C:\Users\Stefano\Desktop\acquedotto attuale"

cd /d %PROJ%

echo.
set /p MSG=Messaggio commit: 
if "%MSG%"=="" (
  echo [ERRORE] Messaggio vuoto.
  pause
  exit /b 1
)

%GIT% add .
if errorlevel 1 goto :err

%GIT% commit -m "%MSG%"
if errorlevel 1 goto :err

%GIT% push
if errorlevel 1 goto :err

echo.
echo [OK] Commit e push completati con successo.
pause
exit /b 0

:err
echo.
echo [ERRORE] Operazione non completata. Controlla i messaggi sopra.
pause
exit /b 1
