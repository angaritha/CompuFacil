#!/usr/bin/env bash
# Actualiza CompuFácil en el servidor con lo último de GitHub (conserva datos y claves).
set -euo pipefail
APP=/opt/compufacil/app
echo "Descargando la última versión…"
sudo -u compufacil git -C $APP fetch --depth 1 origin
sudo -u compufacil git -C $APP reset --hard FETCH_HEAD
sudo -u compufacil bash -c "cd $APP/ia && venv/bin/pip install -q -r requirements.txt"
sudo -u compufacil bash -c "cd $APP/bot && PUPPETEER_SKIP_DOWNLOAD=1 npm install --no-audit --no-fund --loglevel=error"
systemctl restart compufacil-ia
sleep 4
systemctl restart compufacil-bot
echo "Listo. Estado:"
systemctl --no-pager --lines=0 status compufacil-ia compufacil-bot | grep -E "Active|●"
cat /opt/compufacil/URL.txt 2>/dev/null || true
