#!/usr/bin/env bash
# =============================================================================
# CompuFácil · instalación en un servidor Ubuntu (Oracle Cloud Always Free)
#
# Uso (como script de inicio "cloud-init" al crear la instancia, o por SSH):
#   curl -fsSL https://raw.githubusercontent.com/angaritha/CompuFacil/HEAD/deploy/oracle/install.sh | sudo bash
#
# Deja funcionando, siempre encendidos y con reinicio automático:
#   - compufacil-ia  : servicio de IA + panel (FastAPI, solo en 127.0.0.1:8000)
#   - compufacil-bot : bot de WhatsApp (Node + WPPConnect + Chromium)
#   - caddy          : HTTPS automático para el panel en https://<ip>.sslip.io
# Es seguro volver a ejecutarlo: actualiza el código y conserva datos y claves.
# =============================================================================
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

REPO="${COMPUFACIL_REPO:-https://github.com/angaritha/CompuFacil.git}"
BASE=/opt/compufacil
APP=$BASE/app
SVC_USER=compufacil
LOG=/var/log/compufacil-install.log
exec > >(tee -a "$LOG") 2>&1
step() { echo; echo "=== [$(date '+%H:%M:%S')] $* ==="; }

step "1/8 Zona horaria y paquetes base"
timedatectl set-timezone America/Bogota || true
apt-get update -y
apt-get install -y git curl ca-certificates gnupg python3-venv python3-pip \
  software-properties-common debian-keyring debian-archive-keyring apt-transport-https \
  iptables-persistent fonts-liberation

# Memoria de intercambio si la máquina es pequeña (p. ej. la AMD de 1 GB)
if [ "$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)" -lt 3000 ] && [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

step "2/8 Node.js 20"
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v

step "3/8 Chromium (para WhatsApp Web)"
CHROME=""
if ! command -v chromium >/dev/null; then
  add-apt-repository -y ppa:xtradeb/apps && apt-get update -y && apt-get install -y chromium || true
fi
for c in /usr/bin/chromium /usr/bin/chromium-browser /snap/bin/chromium; do
  if [ -x "$c" ]; then CHROME=$c; break; fi
done
if [ -z "$CHROME" ]; then
  # Respaldo: Chromium de Playwright (tiene versión para ARM64)
  mkdir -p $BASE/.cache && chown -R $SVC_USER:$SVC_USER $BASE 2>/dev/null || true
  id -u $SVC_USER >/dev/null 2>&1 || useradd --system --create-home --home-dir $BASE --shell /usr/sbin/nologin $SVC_USER
  npx -y playwright@1.47.2 install-deps chromium || true
  sudo -u $SVC_USER HOME=$BASE npx -y playwright@1.47.2 install chromium || true
  CHROME=$(ls -d $BASE/.cache/ms-playwright/chromium-*/chrome-linux/chrome 2>/dev/null | head -1 || true)
fi
[ -n "$CHROME" ] || { echo "No se pudo instalar Chromium"; exit 1; }
echo "Chromium: $CHROME"

step "4/8 Caddy (HTTPS automático)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

step "5/8 Código de CompuFácil"
id -u $SVC_USER >/dev/null 2>&1 || useradd --system --create-home --home-dir $BASE --shell /usr/sbin/nologin $SVC_USER
mkdir -p $BASE
if [ -d $APP/.git ]; then
  git -C $APP fetch --depth 1 origin && git -C $APP reset --hard FETCH_HEAD
else
  git clone --depth 1 "$REPO" $APP
fi
chown -R $SVC_USER:$SVC_USER $BASE

step "6/8 Dependencias de Python y del bot"
sudo -u $SVC_USER bash -c "cd $APP/ia && python3 -m venv venv && venv/bin/pip install -q --upgrade pip && venv/bin/pip install -q -r requirements.txt"
sudo -u $SVC_USER bash -c "cd $APP/bot && PUPPETEER_SKIP_DOWNLOAD=1 npm install --no-audit --no-fund --loglevel=error"

# .env: se crea una sola vez. La clave de Groq se pega luego en el panel → Ajustes.
if [ ! -f $APP/ia/.env ]; then
  cat > $APP/ia/.env <<ENV
PANEL_PASSWORD=compu2026
HOST=127.0.0.1
ENV
  chown $SVC_USER:$SVC_USER $APP/ia/.env && chmod 600 $APP/ia/.env
fi

step "7/8 Servicios (siempre encendidos)"
cat > /etc/systemd/system/compufacil-ia.service <<UNIT
[Unit]
Description=CompuFacil - IA y panel
After=network-online.target
Wants=network-online.target

[Service]
User=$SVC_USER
WorkingDirectory=$APP/ia
Environment=HOST=127.0.0.1 TZ=America/Bogota PYTHONUNBUFFERED=1
ExecStart=$APP/ia/venv/bin/python main.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/compufacil-bot.service <<UNIT
[Unit]
Description=CompuFacil - Bot de WhatsApp
After=compufacil-ia.service network-online.target
Wants=compufacil-ia.service

[Service]
User=$SVC_USER
WorkingDirectory=$APP/bot
Environment=CHROME_PATH=$CHROME CHROME_NO_SANDBOX=1 TZ=America/Bogota NODE_ENV=production
ExecStart=/usr/bin/node bot.js
Restart=always
RestartSec=15
KillSignal=SIGINT
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
UNIT

install -m 755 $APP/deploy/oracle/update.sh /usr/local/bin/compufacil-actualizar
systemctl daemon-reload
systemctl enable compufacil-ia compufacil-bot
systemctl restart compufacil-ia
sleep 5
systemctl restart compufacil-bot

step "8/8 HTTPS para el panel y cortafuegos"
for p in 80 443; do
  if ! iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null; then
    pos=$(iptables -L INPUT --line-numbers | awk '/REJECT/{print $1; exit}')
    if [ -n "$pos" ]; then iptables -I INPUT "$pos" -p tcp --dport $p -j ACCEPT; else iptables -A INPUT -p tcp --dport $p -j ACCEPT; fi
  fi
done
netfilter-persistent save || true

IP=$(curl -fsS https://api.ipify.org || curl -fsS https://ifconfig.me)
DOMAIN="${COMPUFACIL_DOMAIN:-$(echo "$IP" | tr . -).sslip.io}"
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	encode gzip
	# Solo el panel queda en internet; la API del bot sigue siendo local.
	@panel path /panel /panel/* /api/admin/* /api/ia-status
	handle @panel {
		reverse_proxy 127.0.0.1:8000
	}
	handle / {
		redir /panel
	}
	handle {
		respond "No encontrado" 404
	}
}
CADDY
systemctl restart caddy

echo "https://$DOMAIN/panel" > $BASE/URL.txt
echo
echo "=============================================================="
echo " CompuFácil instalado."
echo " Panel: https://$DOMAIN/panel   (clave inicial: compu2026)"
echo " 1) Entra al panel → Ajustes → pega la clave de Groq."
echo " 2) En Resumen aparece el QR: escanéalo desde WhatsApp."
echo " Actualizar más adelante: sudo compufacil-actualizar"
echo "=============================================================="
