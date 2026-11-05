# CompuFácil en Oracle Cloud (Always Free, 24/7)

Con esta guía el bot queda encendido todo el tiempo en una máquina gratuita
de Oracle Cloud. El script `install.sh` instala y configura todo solo.

## 1. Cuenta

1. Regístrate en https://signup.cloud.oracle.com.
2. Elige una **región de inicio** con cupo ARM, por ejemplo *US East (Ashburn)* o *Brazil East (São Paulo)*. No se puede cambiar después.
3. Oracle pide una tarjeta solo para verificar tu identidad. No cobra mientras uses los recursos *Always Free*.

## 2. Crear la instancia

En la consola: **Compute → Instances → Create instance**.

| Campo | Valor |
|---|---|
| Nombre | `compufacil` |
| Image | **Canonical Ubuntu 24.04** |
| Shape | **Ampere · VM.Standard.A1.Flex** · 2 OCPU · 12 GB (Always Free) |
| Networking | Crear VCN nueva con subred pública · *Assign a public IPv4 address* |
| SSH keys | *Generate a key pair* y **descarga la clave privada** (para emergencias) |
| Advanced options → Management → **Initialization script** | *Paste cloud-init script* (ver abajo) |

```bash
#!/bin/bash
curl -fsSL https://raw.githubusercontent.com/angaritha/CompuFacil/HEAD/deploy/oracle/install.sh | bash
```

Si aparece *Out of capacity* para Ampere, intenta en unas horas, cambia el
*Availability domain* o usa **VM.Standard.E2.1.Micro** (AMD, 1 GB). En la AMD
el script agrega memoria de intercambio, pero va más justa.

## 3. Abrir los puertos 80 y 443

Ve a **Networking → Virtual cloud networks → tu VCN → Security Lists → Default
Security List → Add Ingress Rules** y agrega dos reglas:

| Campo | Valor |
|---|---|
| Source CIDR | `0.0.0.0/0` |
| IP Protocol | TCP |
| Destination port range | `80` en una regla y `443` en la otra |

El script ya abre los mismos puertos en el cortafuegos de Ubuntu.

## 4. Primer ingreso

1. Espera unos 10 minutos a que termine la instalación.
2. Abre `https://<IP-con-guiones>.sslip.io/panel`. Por ejemplo, la IP `129.146.10.20` queda como `https://129-146-10-20.sslip.io/panel`.
3. Entra con la clave inicial `compu2026`.
4. **Ajustes:**
   - pega la clave de Groq (https://console.groq.com/keys);
   - cambia la clave del panel.
5. **Resumen:** escanea el QR con el WhatsApp del bot (*Dispositivos vinculados*).

## Mantenimiento

Estos comandos se ejecutan por SSH o desde la *Cloud Shell* de Oracle.

| Tarea | Comando |
|---|---|
| Actualizar con lo último de GitHub | `sudo compufacil-actualizar` |
| Ver si todo está encendido | `systemctl status compufacil-ia compufacil-bot caddy` |
| Ver registros del bot | `sudo journalctl -u compufacil-bot -n 100` |
| Reiniciar el bot | `sudo systemctl restart compufacil-bot` |
| Registro de la instalación | `/var/log/compufacil-install.log` |

Ubicación de los datos:

| Dato | Carpeta |
|---|---|
| Base de datos | `/opt/compufacil/app/ia/compufacil.db` |
| Videos | `/opt/compufacil/app/bot/assets/videos/` |
| Sesión de WhatsApp | `/opt/compufacil/app/bot/tokens/` |

Las actualizaciones no borran nada de esto.
