# Dashboard Vasca sul Raspberry (accesso pubblico)

Pagina web + API ThingSpeak sul Pi, raggiungibile da Internet con **Cloudflare Tunnel** (consigliato: niente porte aperte sul router).

## Cosa c’è nella cartella

| File | Ruolo |
|------|--------|
| `server.js` | Server Node: HTML + `/api/data` |
| `public/index.html` | Dashboard (come Google Script, ma con `fetch`) |
| `.env` / `.env.example` | Chiavi ThingSpeak (non condividere `.env`) |
| `vasca.service` | Avvio automatico systemd |
| `cloudflared-config.example.yml` | Esempio tunnel Cloudflare |

## 1. Copia sul Raspberry

Dal PC (esempio con scp):

```bash
scp -r raspberry_vasca pi@IP_DEL_PI:~/vasca
```

Sul Pi:

```bash
cd ~/vasca
cp .env.example .env   # se non hai già .env
nano .env              # controlla le Read API Key
sudo apt update
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
npm install
node server.js
```

Prova in LAN: `http://IP_DEL_PI:3000`

## 2. Avvio automatico

```bash
sudo cp ~/vasca/vasca.service /etc/systemd/system/vasca.service
# Se la cartella non è /home/pi/vasca, modifica WorkingDirectory e User
sudo systemctl daemon-reload
sudo systemctl enable --now vasca
sudo systemctl status vasca
```

## 3. Pubblicare su Internet (Cloudflare Tunnel) — consigliato

**Perché Tunnel:** HTTPS gratis, nessun port-forward, IP di casa nascosto.

### Requisiti
- Account Cloudflare gratuito
- Un dominio gestito da Cloudflare (anche gratis)

### Installazione cloudflared sul Pi

```bash
# ARM64 (Pi 4/5 a 64 bit) — verifica arch: uname -m
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i cloudflared.deb
```

Per Pi a 32 bit usa `cloudflared-linux-arm.deb`.

### Login e tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create vasca
cloudflared tunnel route dns vasca vasca.TUODOMINIO.com
```

Crea `~/.cloudflared/config.yml` (vedi `cloudflared-config.example.yml`):

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /home/pi/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: vasca.TUODOMINIO.com
    service: http://127.0.0.1:3000
  - service: http_status:404
```

Avvio automatico tunnel:

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

Apri nel browser: `https://vasca.TUODOMINIO.com`

## 4. Alternativa: port forwarding (meno sicura)

1. IP fisso al Pi sul router  
2. Inoltra porta **80** (o 443) → `IP_PI:3000`  
3. Opzionale: HTTPS con Let’s Encrypt  

Svantaggi: IP pubblico esposto, router da configurare, rischio scansioni.

## 5. Sicurezza (pagina pubblica)

- Le **Read API Key** restano solo sul Pi (file `.env`), non nel browser  
- Non pubblicare `.env` su GitHub  
- Opzionale Cloudflare Access (login email) se vuoi limitare chi vede la dashboard  
- Opzionale password HTTP basic davanti a Node/Nginx  

## 6. Verifica

```bash
curl -s http://127.0.0.1:3000/api/health
curl -s "http://127.0.0.1:3000/api/data?days=4h" | head -c 200
```

## Troubleshooting

| Problema | Cosa controllare |
|----------|------------------|
| Pagina bianca / Errore API | `journalctl -u vasca -e` e chiavi in `.env` |
| Tunnel non apre | `sudo systemctl status cloudflared` e DNS Cloudflare |
| Lento su “1 mese” | Normale: molte richieste ThingSpeak (~15–40 s) |
