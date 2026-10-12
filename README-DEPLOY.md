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
> Render **TCP Proxy ندارد**؛ رله‌ی TCP را روی Railway یا VPS خودتان اجرا کنید.

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

## ۴) رله‌ها
- فقط سه مورد: رله‌ی TCP روی Railway، رله‌ی WebSocket روی دامنه‌ی پنل و رله‌ی TCP روی VPS شخصی.

## 4) Relays
- Only three: TCP relay on Railway, WebSocket relay on the panel domain, and TCP relay on a personal VPS.
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
