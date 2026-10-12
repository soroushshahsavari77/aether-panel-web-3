# Deploy guide / راهنمای دپلوی

**[فارسی](#fa) · [English](#en)**

> Full documentation: [README.md](README.md) · Variable reference: [.env.example](.env.example)
> مستندات کامل: [README.md](README.md) · مرجع متغیرها: [.env.example](.env.example)

---

<a id="fa"></a>
# 🇮🇷 فارسی

## پیش‌نیاز
- ریپو روی GitHub خودتان (Fork یا Push).
- حساب Railway (پیشنهادی) یا Render (پلن **پولی**)، یا یک VPS با Docker.
- یک رمز طولانی و تصادفی برای پنل و یکی برای اشتراک.

## ۱) Railway — گام‌به‌گام

### ۱.۱ سرویس
1. **New Project ← Deploy from GitHub repo** و ریپو را انتخاب کنید. `Dockerfile` ریشه خودکار شناسایی می‌شود.
2. Start Command را **عوض نکنید**؛ ایمیج با `server.mjs` (همان `next start` به‌علاوه‌ی هوک WebSocket) راه می‌افتد.
3. در **Variables**:

| متغیر | الزامی؟ | مقدار |
| --- | --- | --- |
| `PANEL_USER`، `PANEL_PASSWORD` | ✅ | ورود به پنل |
| `TMPDIR` | توصیه می‌شود | `/data/tmp` (بعد از ساخت Volume) |
| `AUTO_START` | توصیه می‌شود | `1` (اتصال خودکار تونل بعد از هر ری‌استارت) |
| `SHARE_AUTO` | توصیه می‌شود | `1` (رله‌ها همراه تونل روشن شوند) |
| `SHARE_USERNAME`، `SHARE_PASSWORD` | توصیه می‌شود | نام کاربری ۳–۳۲ و رمز ۸–۶۴ کاراکتر از `A-Za-z0-9._~-` |
| `RELAY_PORT` | برای رله‌ی TCP | `1080` (هر پورت آزاد به‌جز `PORT` و `PORT+1`) |
| `SHARE_BORE` | اختیاری | `0` = bore خاموش (bore مستقل از Railway است) |
| `SHARE_PROTOCOLS` | اختیاری | `socks,http,ss` (پیش‌فرض). برای فقط رمزنگاری‌شده: `ss` |
| `INBOUND_WS` | اختیاری | `vless,trojan` (پیش‌فرض) یا `off` |
| `INBOUND_WS_PATH` | اختیاری | مسیر دلخواه WebSocket، مثل `/my-secret-path` |
| `NOTIFY_*` | اختیاری | بخش اعلان‌ها در `.env.example` |

4. **Settings ← Networking ← Generate Domain** برای پنل. پورت هدف دامنه باید برابر `PORT` سرویس باشد.

### ۱.۲ Volume (تنظیمات و هویت WARP بعد از ری‌استارت بمانند)
**Settings ← Volumes** ← یک Volume روی `/data` بسازید و `TMPDIR=/data/tmp` را بگذارید. بدون آن، پنل بنر `Settings and WARP identity will be lost on restart.` نشان می‌دهد و تنظیمات، رمز اشتراک، هویت WARP و باینری رله‌ها با هر ری‌استارت پاک می‌شود.

### ۱.۳ TCP Proxy (`host:port` ثابت)
1. **Settings ← Networking ← TCP Proxy ← Add**.
2. «Application port» را برابر `RELAY_PORT` (مثلاً `1080`) بگذارید.
3. Railway این متغیرها را خودش تزریق می‌کند و پنل آن‌ها را می‌خواند؛ چیزی لازم نیست کپی کنید:
   `RAILWAY_TCP_PROXY_DOMAIN`، `RAILWAY_TCP_PROXY_PORT`، `RAILWAY_TCP_APPLICATION_PORT`. تا وقتی TCP Proxy را حذف نکنید ثابت می‌مانند.
4. **Redeploy** کنید. در پنل تونل را وصل کنید و «ساخت آدرس عمومی» را بزنید (یا `SHARE_AUTO=1`).
5. اگر `RELAY_PORT` را نگذارید ولی TCP Proxy فعال باشد، `RAILWAY_TCP_APPLICATION_PORT` استفاده می‌شود. خارج از Railway: `RELAY_PUBLIC_HOST` و `RELAY_PUBLIC_PORT` را دستی بدهید.

### ۱.۴ VLESS / Trojan روی WebSocket (دامنه‌ی پنل، پورت ۴۴۳)
نیاز به تنظیم اضافه ندارد: دامنه‌ی Railway پنل، upgrade وب‌سوکت را با TLS لبه روی ۴۴۳ حمل می‌کند و شبیه HTTPS معمولی دیده می‌شود. اشتراک را روشن کنید و لینک `vless://` یا `trojan://` را از بلوک **Panel domain** بردارید.
- مسیر پیش‌فرض از رمز اشتراک مشتق می‌شود (`/ws/<۱۲ hex>`)؛ برای مسیر دلخواه `INBOUND_WS_PATH` را بگذارید.
- فقط TCP (بدون UDP و mux).
- Start Command را عوض نکنید (`server.mjs`).

### ۱.۵ چک‌لیست بعد از دپلوی
- [ ] `https://<دامنه>/healthz` پاسخ `ok` می‌دهد (بدون رمز)
- [ ] ورود به پنل با رمز کار می‌کند
- [ ] بنر ماندگاری دیده نمی‌شود
- [ ] وضعیت **connected** است و IP خروجی نمایش داده می‌شود
- [ ] رله‌ی Railway در حالت **on** است (نه pending/error)

## ۲) Render
1. **New ← Web Service**، Runtime = **Docker**، Instance Type **پولی** (پلن رایگان می‌خوابد و تونل قطع می‌شود).
2. Environment: `PANEL_USER`، `PANEL_PASSWORD` و در صورت نیاز `AUTO_START=1`، `SHARE_AUTO=1`.
3. **Advanced ← Health Check Path:** `/healthz`.
4. اختیاری: Disk روی `/data` و `TMPDIR=/data/tmp`.
5. دامنه‌ی `*.onrender.com` برای VLESS/Trojan خودکار شناسایی می‌شود.
> Render **TCP Proxy ندارد**؛ رله‌ی TCP باید از bore، playit، ngrok، pinggy یا سرور خودتان (chisel/frp/rathole) بیاید.

## ۳) VPS با Docker
```bash
docker build -t aether-panel .
docker run -d --name aether-panel --restart unless-stopped \
  -p 3000:3000 -p 1080:1080 \
  -e PANEL_USER=admin -e PANEL_PASSWORD='رمز-طولانی' \
  -e AUTO_START=1 -e SHARE_AUTO=1 \
  -e SHARE_USERNAME=myuser -e SHARE_PASSWORD='رمز-اشتراک-طولانی' \
  -e RELAY_PORT=1080 -e RELAY_PUBLIC_HOST=YOUR.SERVER.IP.OR.DOMAIN -e RELAY_PUBLIC_PORT=1080 \
  -e INBOUND_PUBLIC_HOST=panel.example.com \
  -v aether-data:/data -e TMPDIR=/data/tmp \
  aether-panel
```
- پنل را پشت Nginx/Caddy با HTTPS بگذارید و برای VLESS/Trojan هدرهای `Upgrade` و `Connection: upgrade` را به پورت ۳۰۰۰ پاس بدهید.
- پورت `RELAY_PORT` از اینترنت باز است و تنها محافظ آن نام کاربری/رمز است.
- نمونه‌ی `docker-compose.yml` در README.md هست.

## ۴) رله‌های بیشتر (همه اختیاری و مستقل)
- **اصلی:** playit.gg، Pinggy، ngrok TCP، chisel / frp / rathole به سرور خودتان (chisel را روی https/WS ترجیح دهید و `CHISEL_SERVER=https://…` بگذارید).
- **پشتیبان** (فقط وقتی هیچ رله‌ی اصلی زنده نیست): Serveo و LocalToNet.
- playit.gg و LocalToNet به `GATEWAY_PORT` نیاز دارند (تونل آن‌ها باید به `127.0.0.1:GATEWAY_PORT` اشاره کند).
- سمت سرور chisel: `chisel server --reverse --port 8080 --auth user:pass` پشت reverse proxy یا CDN با TLS.
- فهرست کامل متغیرها: `.env.example`؛ راهنمای راه‌اندازی هر رله: README.md ← «رله‌ها».

## ۵) اعلان‌ها
Webhook (`NOTIFY_WEBHOOK_URL`) و/یا تلگرام (`NOTIFY_TELEGRAM_BOT_TOKEN` + `NOTIFY_TELEGRAM_CHAT_ID`). رویدادها: `tunnel_down`، `subscription_changed`، `relay_error`؛ تکرار تا `NOTIFY_COOLDOWN_SEC` سرکوب می‌شود. پیام `subscription_changed` رمز رله را دارد؛ فقط به کانال خصوصی بفرستید.

## ۶) نسخه‌ی پین‌شده‌ی Aether
`Dockerfile`: `ARG AETHER_VERSION=v1.5.0`. تغییر: `--build-arg AETHER_VERSION=vX.Y.Z` (روی Railway: `AETHER_VERSION` را به‌عنوان متغیر سرویس اضافه کنید). Checksum هنگام بیلد بررسی می‌شود.

## ۷) بررسی محلی
```bash
pnpm install && pnpm typecheck && npm test
docker build -t aether-panel .
```

---

<a id="en"></a>
# 🇬🇧 English

## Prerequisites
- The repo on your own GitHub (fork or push).
- A Railway account (recommended), a Render account (**paid** instance), or a VPS with Docker.
- A long random password for the panel and another for sharing.

## 1) Railway — step by step

### 1.1 Service
1. **New Project → Deploy from GitHub repo**, pick the repo. The root `Dockerfile` is detected automatically.
2. **Do not override** the Start Command; the image starts through `server.mjs` (`next start` plus the WebSocket hook).
3. In **Variables**:

| Variable | Required? | Value |
| --- | --- | --- |
| `PANEL_USER`, `PANEL_PASSWORD` | ✅ | panel login |
| `TMPDIR` | recommended | `/data/tmp` (after adding the volume) |
| `AUTO_START` | recommended | `1` (the tunnel reconnects after every restart) |
| `SHARE_AUTO` | recommended | `1` (relays start with the tunnel) |
| `SHARE_USERNAME`, `SHARE_PASSWORD` | recommended | username 3–32 and password 8–64 chars from `A-Za-z0-9._~-` |
| `RELAY_PORT` | for the TCP relay | `1080` (any free port except `PORT` and `PORT+1`) |
| `SHARE_BORE` | optional | `0` disables bore (bore is independent of Railway) |
| `SHARE_PROTOCOLS` | optional | `socks,http,ss` (default); encrypted only: `ss` |
| `INBOUND_WS` | optional | `vless,trojan` (default) or `off` |
| `INBOUND_WS_PATH` | optional | custom WebSocket path, e.g. `/my-secret-path` |
| `NOTIFY_*` | optional | see the notifications section of `.env.example` |

4. **Settings → Networking → Generate Domain** for the panel. The domain's target port must equal the service `PORT`.

### 1.2 Volume (settings and the WARP identity survive restarts)
**Settings → Volumes** → create a volume mounted at `/data` and set `TMPDIR=/data/tmp`. Without it the panel shows `Settings and WARP identity will be lost on restart.` and settings, share credentials, the WARP identity and relay binaries are wiped on every restart.

### 1.3 TCP Proxy (stable `host:port`)
1. **Settings → Networking → TCP Proxy → Add**.
2. Set "Application port" to your `RELAY_PORT` (e.g. `1080`).
3. Railway injects these into the service and the panel reads them; nothing to copy:
   `RAILWAY_TCP_PROXY_DOMAIN`, `RAILWAY_TCP_PROXY_PORT`, `RAILWAY_TCP_APPLICATION_PORT`. They stay stable until the proxy is deleted.
4. **Redeploy**. In the panel connect the tunnel and press the share button (or use `SHARE_AUTO=1`).
5. If `RELAY_PORT` is unset but a TCP Proxy exists, `RAILWAY_TCP_APPLICATION_PORT` is used. Outside Railway set `RELAY_PUBLIC_HOST` / `RELAY_PUBLIC_PORT` yourself.

### 1.4 VLESS / Trojan over WebSocket (panel domain, port 443)
No extra setup: the panel's Railway domain carries the WebSocket upgrade (edge TLS on 443), so it looks like ordinary HTTPS. Start sharing and copy the `vless://` or `trojan://` link from the **Panel domain** block.
- The default path is derived from the share password (`/ws/<12 hex>`); set `INBOUND_WS_PATH` for a custom one.
- TCP only (no UDP, no mux).
- Keep the Start Command (`server.mjs`).

### 1.5 Post-deploy checklist
- [ ] `https://<domain>/healthz` answers `ok` (no auth)
- [ ] Panel login works
- [ ] The persistence banner is gone
- [ ] Status is **connected** and the exit IP is shown
- [ ] The Railway relay is **on** (not pending/error)

## 2) Render
1. **New → Web Service**, runtime **Docker**, a **paid** instance type (the free plan sleeps and drops the tunnel).
2. Environment: `PANEL_USER`, `PANEL_PASSWORD`, and optionally `AUTO_START=1`, `SHARE_AUTO=1`.
3. **Advanced → Health Check Path:** `/healthz`.
4. Optional: a disk at `/data` plus `TMPDIR=/data/tmp`.
5. The `*.onrender.com` domain is detected automatically for VLESS/Trojan.
> Render has **no TCP Proxy**; the TCP relay must come from bore, playit, ngrok, pinggy or your own server (chisel/frp/rathole).

## 3) VPS with Docker
```bash
docker build -t aether-panel .
docker run -d --name aether-panel --restart unless-stopped \
  -p 3000:3000 -p 1080:1080 \
  -e PANEL_USER=admin -e PANEL_PASSWORD='a-long-password' \
  -e AUTO_START=1 -e SHARE_AUTO=1 \
  -e SHARE_USERNAME=myuser -e SHARE_PASSWORD='a-long-share-password' \
  -e RELAY_PORT=1080 -e RELAY_PUBLIC_HOST=YOUR.SERVER.IP.OR.DOMAIN -e RELAY_PUBLIC_PORT=1080 \
  -e INBOUND_PUBLIC_HOST=panel.example.com \
  -v aether-data:/data -e TMPDIR=/data/tmp \
  aether-panel
```
- Put the panel behind Nginx/Caddy with HTTPS and forward the `Upgrade` / `Connection: upgrade` headers to port 3000 for VLESS/Trojan.
- `RELAY_PORT` is reachable from the internet and the username/password is its only protection.
- A sample `docker-compose.yml` is in README.md.

## 4) More relays (all optional and independent)
- **Primary:** playit.gg, Pinggy, ngrok TCP, chisel / frp / rathole to your own server (prefer chisel over https/WS: `CHISEL_SERVER=https://…`).
- **Fallback** (only while no primary relay is live): Serveo and LocalToNet.
- playit.gg and LocalToNet need `GATEWAY_PORT` (their tunnel must target `127.0.0.1:GATEWAY_PORT`).
- chisel server side: `chisel server --reverse --port 8080 --auth user:pass` behind a TLS reverse proxy or CDN.
- Every variable is listed in `.env.example`; per-relay setup guides are in README.md → "Relays".

## 5) Notifications
Webhook (`NOTIFY_WEBHOOK_URL`) and/or Telegram (`NOTIFY_TELEGRAM_BOT_TOKEN` + `NOTIFY_TELEGRAM_CHAT_ID`). Events: `tunnel_down`, `subscription_changed`, `relay_error`; repeats are suppressed for `NOTIFY_COOLDOWN_SEC`. `subscription_changed` messages contain the relay credentials; send them to private channels only.

## 6) Pinned Aether
`Dockerfile`: `ARG AETHER_VERSION=v1.5.0`. Change it with `--build-arg AETHER_VERSION=vX.Y.Z` (Railway: add `AETHER_VERSION` as a service variable). The checksum is verified at build time.

## 7) Local checks
```bash
pnpm install && pnpm typecheck && npm test
docker build -t aether-panel .
```
