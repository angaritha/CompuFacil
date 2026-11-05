@echo off
chcp 65001 >nul
title CompuFacil - Inicio
cd /d "%~dp0"

echo ==============================================
echo   CompuFacil - iniciando servicios
echo ==============================================

rem --- Python del entorno virtual (ia\venv o venv en la raiz) ---
set "PY=python"
if exist "ia\venv\Scripts\python.exe" set "PY=%~dp0ia\venv\Scripts\python.exe"
if not exist "ia\venv\Scripts\python.exe" if exist "venv\Scripts\python.exe" set "PY=%~dp0venv\Scripts\python.exe"

echo [0/3] Revisando dependencias de Python...
"%PY%" -m pip install -q --disable-pip-version-check -r "%~dp0ia\requirements.txt"

echo [0/3] Revisando dependencias del bot (la primera vez puede tardar)...
pushd "%~dp0bot"
call npm install --no-audit --no-fund --loglevel=error
popd

echo [1/3] Motor de IA y panel (FastAPI)...
start "CompuFacil - IA y Panel" cmd /k "cd /d "%~dp0ia" && "%PY%" main.py"

echo Esperando a que el servicio de IA arranque...
timeout /t 6 /nobreak >nul

echo [2/3] Bot de WhatsApp...
start "CompuFacil - Bot WhatsApp" cmd /k "cd /d "%~dp0bot" && node bot.js"

echo [3/3] Abriendo el panel en el navegador...
timeout /t 3 /nobreak >nul
start "" "http://localhost:8000/panel"

echo.
echo Listo. Deja abiertas las dos ventanas negras mientras uses el bot.
echo Para apagar: cierra esas ventanas o presiona Ctrl+C en cada una.
timeout /t 8 >nul
