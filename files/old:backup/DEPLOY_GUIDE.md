# OpenClaw — Full Deployment Guide

Everything you need to go from a local HTML file to a live, persisted dashboard
at `https://dashboard.yourdomain.com`.

---

## What you'll end up with

```
Internet
  └─ Cloudflare (SSL + DNS)
       └─ Nginx (reverse proxy, port 80/443)
            └─ Node.js / Express (port 3001, localhost only)
                 ├─ GET  /api/state      ← read dashboard state
                 ├─ POST /api/state      ← save dashboard state
                 ├─ POST /api/archive    ← move done→history
                 └─ /public/index.html  ← serves the frontend
```

State is stored in a single JSON file on your VPS. A cron job runs at midnight
every night and automatically archives any uncleared done-tasks into the heatmap.

---

## Files in this bundle

| File | Purpose |
|------|---------|
| `server.js` | Node.js backend API |
| `archive-cron.js` | Script run by midnight cron |
| `package.json` | Node.js dependencies |
| `public/index.html` | Frontend (API-connected version) |
| `DEPLOY_GUIDE.md` | This file |

---

## Phase 1 — Set up Node.js on your VPS

SSH into your server first:

```bash
ssh ubuntu@YOUR_SERVER_IP
```

Install Node Version Manager (nvm), which is the easiest way to get Node.js:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
```

Close and reopen your SSH connection (or run the command it prints), then install
Node.js 20 (current LTS):

```bash
nvm install 20
nvm use 20
node --version     # should print v20.x.x
```

Install PM2 globally — this keeps the server running after you disconnect:

```bash
npm install -g pm2
```

---

## Phase 2 — Upload the project files

On your VPS, create the project directory:

```bash
mkdir -p ~/openclaw/public
```

Now upload the files from your computer. Open a **new terminal window on your
local machine** (not on the server) and run:

```bash
scp server.js archive-cron.js package.json ubuntu@YOUR_SERVER_IP:~/openclaw/
scp public/index.html ubuntu@YOUR_SERVER_IP:~/openclaw/public/
```

Back on the server, install Node.js dependencies:

```bash
cd ~/openclaw
npm install
```

---

## Phase 3 — Configure and start the API

Pick a strong random secret key. Run this on the server to generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy that output — you'll use it in two places.

**3a. Set up the environment variable permanently**

```bash
nano ~/.bashrc
```

Scroll to the bottom and add this line (paste your key where it says YOUR_KEY):

```bash
export OPENCLAW_KEY="YOUR_KEY_HERE"
```

Save with Ctrl+O, Enter, then Ctrl+X to exit. Apply it now:

```bash
source ~/.bashrc
echo $OPENCLAW_KEY     # should print your key
```

**3b. Edit the frontend config**

Open the frontend file on the server:

```bash
nano ~/openclaw/public/index.html
```

Find these two lines near the top of the `<script>` section:

```javascript
const API_URL = "https://dashboard.yourdomain.com";
const API_KEY = "PASTE_YOUR_SECRET_KEY_HERE";
```

Replace `dashboard.yourdomain.com` with the actual subdomain you'll set up in
Cloudflare, and paste your secret key. Save and exit (Ctrl+O, Enter, Ctrl+X).

**3c. Start the server with PM2**

```bash
cd ~/openclaw
OPENCLAW_KEY="$OPENCLAW_KEY" pm2 start server.js --name openclaw
pm2 save
pm2 startup
```

The `pm2 startup` command will print a line starting with `sudo`. Copy and run
that line — it makes PM2 restart automatically if the server reboots.

Verify it's running:

```bash
pm2 status
curl -s http://127.0.0.1:3001/health     # should print {"ok":true}
```

---

## Phase 4 — Set up Nginx as a reverse proxy

Install Nginx:

```bash
sudo apt update && sudo apt install -y nginx
```

Create a config file for OpenClaw:

```bash
sudo nano /etc/nginx/sites-available/openclaw
```

Paste this (replace `dashboard.yourdomain.com` with your actual subdomain):

```nginx
server {
    listen 80;
    server_name dashboard.yourdomain.com;

    # Security headers
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-Content-Type-Options nosniff;

    # Increase body limit slightly for state saves
    client_max_body_size 2M;

    location / {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 10s;
    }
}
```

Save and exit. Enable the site and reload Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/openclaw /etc/nginx/sites-enabled/
sudo nginx -t          # should say "syntax is ok" and "test is successful"
sudo systemctl reload nginx
```

---

## Phase 5 — Cloudflare DNS + SSL

1. Log in to Cloudflare and select your domain.

2. Go to **DNS → Records → Add record**:
   - Type: `A`
   - Name: `dashboard` (this creates `dashboard.yourdomain.com`)
   - IPv4 address: your VPS IP
   - Proxy status: **Proxied** (orange cloud — this is important)
   - TTL: Auto

3. Go to **SSL/TLS → Overview** and set the encryption mode to **Full**.
   (Do NOT use "Full (Strict)" unless you've installed a certificate on the VPS.
   "Full" works with Cloudflare's own certificate between Cloudflare and your
   server, which is fine for a personal tool.)

4. Optionally, go to **SSL/TLS → Edge Certificates** and enable
   **Always Use HTTPS** — this redirects any http:// requests automatically.

DNS propagation usually takes 1–5 minutes with Cloudflare.

---

## Phase 6 — Set up the midnight cron job

```bash
crontab -e
```

If it asks which editor, pick nano (option 1). Scroll to the bottom and add:

```
0 0 * * * /bin/node /home/ubuntu/openclaw/archive-cron.js >> /home/ubuntu/openclaw/archive.log 2>&1
```

Save and exit. Verify it was saved:

```bash
crontab -l
```

The `node` path needs to match where nvm installed it. Check with:

```bash
which node
```

If the output is something like `/home/ubuntu/.nvm/versions/node/v20.x.x/bin/node`,
use that full path in the cron line instead of `/bin/node`. For example:

```
0 0 * * * /home/ubuntu/.nvm/versions/node/v20.17.0/bin/node /home/ubuntu/openclaw/archive-cron.js >> /home/ubuntu/openclaw/archive.log 2>&1
```

---

## Phase 7 — Test everything end to end

Open `https://dashboard.yourdomain.com` in your browser.

You should see the loading screen briefly, then the dashboard. Add a task, check
it off, and watch the Done counter go up. Open a new tab and reload — your task
should still be there.

To check save logs:

```bash
pm2 logs openclaw
```

To check archive logs (after midnight runs):

```bash
cat ~/openclaw/archive.log
```

To manually trigger an archive right now (to test):

```bash
curl -s -X POST http://127.0.0.1:3001/api/archive \
  -H "x-api-key: $OPENCLAW_KEY"
```

---

## Useful commands going forward

| What | Command |
|------|---------|
| See server logs | `pm2 logs openclaw` |
| Restart after editing server.js | `pm2 restart openclaw` |
| Check server status | `pm2 status` |
| View current state file | `cat ~/openclaw/state.json` |
| Manual backup | `cp ~/openclaw/state.json ~/openclaw/state.backup.json` |
| Edit frontend | `nano ~/openclaw/public/index.html` then `pm2 restart openclaw` |
| Update Node package | `cd ~/openclaw && npm update && pm2 restart openclaw` |

---

## Troubleshooting

**Dashboard shows "Could not reach the API"**
- Check `pm2 status` — is `openclaw` online?
- Check `pm2 logs openclaw` for errors
- Make sure `API_URL` in `index.html` matches the subdomain exactly (with `https://`)
- Make sure `API_KEY` in `index.html` matches `OPENCLAW_KEY` on the server

**Nginx test fails (`nginx -t`)**
- Check you replaced `dashboard.yourdomain.com` in the config file
- Look for typos with `sudo nginx -t` — it'll point to the exact line

**Cloudflare shows 521 error (web server is down)**
- Your server isn't reachable. Run `pm2 status` — is it running?
- Try `curl http://127.0.0.1:3001/health` on the server directly

**Cloudflare shows 524 (timeout)**
- The server is running but taking too long. Increase `proxy_read_timeout` in nginx config.

**Tasks not persisting across refreshes**
- Look for the red sync dot in the header — if it's red, saves are failing
- Check browser console for network errors
- Verify the API key in `index.html` matches the server exactly

**Cron job not running**
- Run the archive command manually first to make sure it works
- Double-check the full path to `node` with `which node`
- Check syslog: `grep CRON /var/log/syslog | tail -20`
