# پنل وب Aether (غیررسمی) · Aether Web Panel (Unofficial)

**[فارسی](#fa) · [English](#en)**

> ⚠️ پروژه‌ی **غیررسمی** است و وابسته به CluvexStudio نیست. نام و لوگوی Aether متعلق به سازندگان آن است؛ برای انتشار عمومی اجازه بگیرید یا نام و آیکون را عوض کنید.
> ⚠️ **Unofficial** and not affiliated with CluvexStudio. The Aether name and logo belong to its authors; ask permission or rebrand before publishing publicly.

---

<a id="fa"></a>
# 🇮🇷 فارسی

## فهرست
1. [این پروژه چیست؟](#fa-what)
2. [امکانات](#fa-features)
3. [معماری و نحوه‌ی کار](#fa-arch)
4. [شروع سریع (۵ دقیقه)](#fa-quick)
5. [دپلوی روی Railway (گام‌به‌گام)](#fa-railway)
6. [دپلوی روی Render](#fa-render)
7. [دپلوی روی VPS با Docker / Compose](#fa-vps)
8. [اولین ورود و تنظیمات پنل](#fa-panel)
9. [اتصال کلاینت‌ها (گوشی و کامپیوتر)](#fa-clients)
10. [رله‌ها: راه‌اندازی تک‌تک](#fa-relays)
11. [پایداری: watchdog، ذخیره‌ی تنظیمات، AUTO_START](#fa-stability)
12. [اعلان‌ها (Webhook و تلگرام)](#fa-notify)
13. [مرجع کامل متغیرهای محیطی](#fa-env)
14. [API داخلی](#fa-api)
15. [امنیت](#fa-security)
16. [عیب‌یابی](#fa-trouble)
17. [توسعه، تست و CI](#fa-dev)

<a id="fa-what"></a>
## این پروژه چیست؟
[Aether](https://github.com/CluvexStudio/aether) یک کلاینت تونل (مبتنی بر Cloudflare) است که فقط یک پراکسی SOCKS5 روی `127.0.0.1:1819` **داخل همان ماشین** باز می‌کند. این پنل (Next.js) سه کار انجام می‌دهد:

1. Aether را اجرا و مدیریت می‌کند (شروع/توقف، لاگ زنده، تست اتصال، انتخاب پروتکل و حالت اسکن).
2. یک **gateway با نام کاربری و رمز** جلوی آن می‌گذارد و از چند مسیر (رله) به اینترنت می‌رساند؛ یعنی یک آدرس عمومی مثل `host:port` می‌گیرید که گوشی یا کامپیوترتان به آن وصل می‌شود.
3. تونل را **زنده نگه می‌دارد** (watchdog)، بهترین کانفیگ را پیدا می‌کند و در صورت قطعی اعلان می‌فرستد.

<a id="fa-features"></a>
## امکانات
- شروع/توقف با یک دکمه؛ پروتکل (MASQUE، WireGuard، Gool، MiM)، ترنسپورت (h2/h3)، حالت اسکن، نسخه‌ی IP، noize، پورت، پراکسی HTTP و اتصال سریع
- وضعیت زنده، gateway انتخاب‌شده، IP و کشور خروجی، تأخیر، مدت اتصال، لاگ و تست اتصال
- **۲ رله‌ی مستقل:** رله‌ی TCP (Railway TCP Proxy یا VPS شخصی) و دامنه‌ی پنل (WebSocket روی ۴۴۳)
- **۵ نوع لینک:** SOCKS5 (`socks://` و `socks5://`)، لینک یک‌لمسی تلگرام، Shadowsocks AEAD (`ss://`)، HTTP CONNECT، VLESS+WS+TLS و Trojan+WS+TLS
- **Watchdog** با backoff نمایی و بازگشت خودکار به آخرین کانفیگ سالم
- **بهترین کانفیگ:** امتحان خودکار ترکیب پروتکل × ترنسپورت × اسکن و ذخیره‌ی برنده
- ذخیره‌ی تنظیمات روی دیسک و `AUTO_START=1` برای اتصال خودکار بعد از هر ری‌استارت
- اعلان با Webhook (Slack/Discord/…) و ربات تلگرام
- امنیت: Basic Auth روی کل پنل، محدودیت نرخ ورود ناموفق، کند کردن عمدی حدس رمز در gateway
- پنل ریسپانسیو و راست‌به‌چین

<a id="fa-arch"></a>
## معماری و نحوه‌ی کار
```
                       ┌─► رله‌ی TCP (Railway / VPS) ─┐
کلاینت ──► رله‌ها ─────┤
                       └─► دامنه‌ی پنل (WS/443) ──────┤
                                   │
                                   ▼
        gateway (نام کاربری/رمز) — تشخیص پروتکل از بایت‌های اول:
            SOCKS5 (user/pass) | HTTP CONNECT | Shadowsocks AEAD
                                   │
                                   ▼
          SOCKS5 محلی Aether (127.0.0.1:1819، بدون رمز) ──► Cloudflare
```
- هر رله **مستقل** است: وضعیت، پروسه، retry و خطای خودش را دارد و خرابی یکی روی بقیه اثری ندارد.
- VLESS/Trojan از همان پورت HTTP پنل سرو می‌شود؛ لبه‌ی Railway/Render ‏TLS را روی ۴۴۳ تمام می‌کند و ترافیک شبیه HTTPS معمولی دیده می‌شود (فقط TCP؛ UDP و mux پشتیبانی نمی‌شود).
- نسخه‌ی Aether در Dockerfile **پین** است (`ARG AETHER_VERSION=v1.5.0`) و checksum آن هنگام بیلد بررسی می‌شود.

<a id="fa-quick"></a>
## شروع سریع (۵ دقیقه)
```bash
git clone <آدرس-ریپوی-شما> aether-panel && cd aether-panel
docker build -t aether-panel .
docker run -d --name aether-panel --restart unless-stopped -p 3000:3000 \
  -e PANEL_USER=admin \
  -e PANEL_PASSWORD='یک-رمز-طولانی-و-تصادفی' \
  -e AUTO_START=1 \
  -v aether-data:/data -e TMPDIR=/data/tmp \
  aether-panel
```
۱. `http://localhost:3000` را باز کنید و با `PANEL_USER` / `PANEL_PASSWORD` وارد شوید.
۲. دکمه‌ی بزرگ اتصال را بزنید و صبر کنید وضعیت **connected** شود.
۳. «ساخت آدرس عمومی» را بزنید و لینک را در کلاینت وارد کنید.

> لینک‌های WebSocket با دامنه‌ی پنل کار می‌کنند. برای رله‌ی TCP، `RELAY_PORT` را روی Railway (TCP Proxy) یا VPS خودتان تنظیم کنید.

<a id="fa-railway"></a>
## دپلوی روی Railway (گام‌به‌گام)
Railway بهترین گزینه است چون هم دامنه‌ی HTTPS (برای VLESS/Trojan) و هم TCP Proxy با `host:port` ثابت می‌دهد.

### ۱) ساخت سرویس
1. ریپو را در GitHub خودتان Fork/Push کنید.
2. در Railway: **New Project ← Deploy from GitHub repo** و ریپو را انتخاب کنید. `Dockerfile` ریشه خودکار شناسایی می‌شود و نیازی به Start Command نیست (`server.mjs` از طریق `pnpm start` اجرا می‌شود؛ آن را عوض نکنید).
3. وارد **Variables** شوید و این‌ها را بگذارید:

| متغیر | مقدار | توضیح |
| --- | --- | --- |
| `PANEL_USER` | `admin` | **الزامی** |
| `PANEL_PASSWORD` | رمز طولانی | **الزامی** (بدون آن پنل ۵۰۳ می‌دهد) |
| `TMPDIR` | `/data/tmp` | بعد از ساخت Volume (مرحله ۲) |
| `AUTO_START` | `1` | اتصال خودکار بعد از هر ری‌استارت |
| `SHARE_AUTO` | `1` | روشن‌شدن خودکار رله‌ها همراه تونل |
| `SHARE_USERNAME` | مثلاً `myuser` | ۳ تا ۳۲ کاراکتر از `A-Za-z0-9._~-` |
| `SHARE_PASSWORD` | رمز ۸+ کاراکتر | ۸ تا ۶۴ کاراکتر از `A-Za-z0-9._~-` |
| `RELAY_PORT` | `1080` | برای رله‌ی TCP Proxy (هر پورت آزاد به‌جز `PORT` و `PORT+1`) |

4. **Settings ← Networking ← Generate Domain** برای خود پنل. پورت هدف دامنه باید برابر `PORT` سرویس باشد (Railway خودش `PORT` را تزریق می‌کند؛ مقدار پیش‌فرض ایمیج ۳۰۰۰ است).

### ۲) Volume (ماندگاری)
**Settings ← Volumes ← New Volume** را روی مسیر `/data` بسازید و `TMPDIR=/data/tmp` را تنظیم کنید. بدون Volume با هر ری‌استارت این‌ها پاک می‌شود و پنل بنر `Settings and WARP identity will be lost on restart.` نشان می‌دهد:
- تنظیمات تونل و کانفیگ سالم/برنده،
- نام کاربری/رمز اشتراک،
- هویت WARP،
- باینری‌های دانلودشده‌ی رله‌ها.

### ۳) TCP Proxy (آدرس ثابت `host:port`)
1. **Settings ← Networking ← TCP Proxy ← Add**.
2. در «Application port» همان مقدار `RELAY_PORT` (مثلاً `1080`) را بنویسید.
3. Railway یک `host:port` پایدار می‌دهد (مثل `roundhouse.proxy.rlwy.net:12345`) و خودش `RAILWAY_TCP_PROXY_DOMAIN`، `RAILWAY_TCP_PROXY_PORT` و `RAILWAY_TCP_APPLICATION_PORT` را تزریق می‌کند. پنل آن‌ها را می‌خواند؛ چیزی برای کپی کردن نیست.
4. **Redeploy** کنید.
5. اگر `RELAY_PORT` را نگذارید ولی TCP Proxy فعال باشد، از `RAILWAY_TCP_APPLICATION_PORT` استفاده می‌شود.

### ۴) راه‌اندازی در پنل
1. آدرس دامنه‌ی Railway را باز کنید و وارد شوید.
2. تونل را وصل کنید (یا با `AUTO_START=1` خودش وصل می‌شود).
3. «ساخت آدرس عمومی» را بزنید (یا با `SHARE_AUTO=1` خودکار انجام می‌شود).
4. در بخش اشتراک، بلوک «Railway relay» و «Panel domain» لینک‌ها را نشان می‌دهد.

### چک‌لیست پس از دپلوی
- [ ] `https://<دامنه>/healthz` عبارت `ok` برمی‌گرداند (بدون رمز)
- [ ] ورود به پنل با رمز کار می‌کند
- [ ] بنر «Settings and WARP identity…» دیده نمی‌شود
- [ ] وضعیت **connected** است و IP خروجی نمایش داده می‌شود
- [ ] رله‌ی Railway در حالت **on** است (نه pending/error)

<a id="fa-render"></a>
## دپلوی روی Render
1. **New ← Web Service**، Runtime = **Docker**، ریپو را وصل کنید.
2. Instance Type باید **پولی** باشد (پلن رایگان سرویس را می‌خواباند و تونل قطع می‌شود).
3. Environment: `PANEL_USER`، `PANEL_PASSWORD` و در صورت نیاز `AUTO_START=1`، `SHARE_AUTO=1`.
4. **Advanced ← Health Check Path:** `/healthz`.
5. (اختیاری ولی توصیه‌شده) Disk روی `/data` و `TMPDIR=/data/tmp`.
6. دامنه‌ی `*.onrender.com` برای VLESS/Trojan خودکار شناسایی می‌شود (`RENDER_EXTERNAL_HOSTNAME`).

> Render **TCP Proxy ندارد.** رله‌ی TCP را روی Railway یا VPS خودتان اجرا کنید؛ روی Render فقط رله‌ی WebSocket کار می‌کند.

<a id="fa-vps"></a>
## دپلوی روی VPS با Docker / Compose
فایل `docker-compose.yml`:
```yaml
services:
  aether-panel:
    build: .
    restart: unless-stopped
    ports:
      - "3000:3000"          # پنل (پشت Nginx/Caddy با HTTPS بگذارید)
      - "1080:1080"          # رله‌ی مستقیم TCP (در صورت استفاده از RELAY_PORT)
    environment:
      PANEL_USER: admin
      PANEL_PASSWORD: ${PANEL_PASSWORD}
      TMPDIR: /data/tmp
      AUTO_START: "1"
      SHARE_AUTO: "1"
      SHARE_USERNAME: myuser
      SHARE_PASSWORD: ${SHARE_PASSWORD}
      RELAY_PORT: "1080"
      RELAY_PUBLIC_HOST: YOUR.SERVER.IP.OR.DOMAIN   # خارج از Railway الزامی است
      RELAY_PUBLIC_PORT: "1080"
      INBOUND_PUBLIC_HOST: panel.example.com        # دامنه‌ی HTTPS شما برای VLESS/Trojan
    volumes:
      - aether-data:/data
volumes:
  aether-data:
```
- برای VLESS/Trojan، یک reverse proxy با TLS بگذارید که **WebSocket Upgrade** را به پورت ۳۰۰۰ پاس بدهد (در Nginx: هدرهای `Upgrade` و `Connection "upgrade"` را ست کنید).
- فایروال: پورت `RELAY_PORT` از اینترنت باز است و تنها محافظ آن نام کاربری/رمز است؛ رمز قوی بگذارید.
- ساخت و اجرا: `PANEL_PASSWORD=... SHARE_PASSWORD=... docker compose up -d --build`.

<a id="fa-panel"></a>
## اولین ورود و تنظیمات پنل

### کارت اتصال و تنظیمات تونل
تنظیمات فقط وقتی تونل **خاموش** است قابل تغییرند و با هر استارت ذخیره می‌شوند.

| گزینه | مقادیر | توضیح |
| --- | --- | --- |
| پروتکل | `masque` · `wg` · `gool` · `mim` | پیش‌فرض `masque` |
| ترنسپورت | `h2` · `h3` | برای `wg` اعمال نمی‌شود |
| حالت اسکن | `turbo` · `balanced` · `thorough` · `verified` · `ironclad` | `turbo` سریع‌ترین؛ `verified/ironclad` کندترین و دقیق‌ترین |
| نسخه‌ی IP | `4` · `6` · `dual` | پیش‌فرض ۴ |
| noize | `default` · `off` · `light` · `firewall` · `balanced` · `gfw` · `aggressive` | برای عبور از فیلترینگ؛ اگر وصل نشد پروفایل را عوض کنید |
| پورت | ۱۰۲۴ تا ۶۵۵۳۴ | پیش‌فرض ۱۸۱۹ (فقط داخل ماشین) |
| پراکسی HTTP | روشن/خاموش | روی `پورت + ۱` (پیش‌فرض ۱۸۲۰) |
| اتصال سریع | روشن/خاموش | `--quick-reconnect` |

اگر باینری Aether پیدا نشود (خارج از Docker)، کارت نصب نمایش داده می‌شود؛ دکمه‌ی «نصب» همان نسخه‌ی پین‌شده را دانلود و checksum را بررسی می‌کند.

### کارت اشتراک (دسترسی از بیرون)
- «ساخت آدرس عمومی»: gateway و رله‌ها را روشن می‌کند. فقط وقتی تونل **connected** است کار می‌کند.
- «تنظیمات اشتراک»: نام کاربری، رمز و «شروع خودکار». فقط وقتی اشتراک **خاموش** است قابل تغییر است تا لینک زنده زیر دست کاربر عوض نشود.
  - نام کاربری: ۳–۳۲ کاراکتر، رمز: ۸–۶۴ کاراکتر، فقط `A-Za-z0-9._~-`
- اولویت تنظیمات: **فایل ذخیره‌شده از رابط** ← متغیرهای `SHARE_*` ← مقدار تصادفی (که ذخیره می‌شود تا ثابت بماند).
- هر رله‌ی روشن، لینک‌هایش را نشان می‌دهد: `socks://`، `socks5://`، لینک تلگرام، `ss://`، `http://`، `vless://` و `trojan://` و یک **بلوک آماده‌ی کپی** با دکمه‌ی «کپی همه».

### بهترین کانفیگ
دکمه را بزنید؛ پنل به‌طور پیش‌فرض همه‌ی پروتکل‌ها و ترنسپورت‌ها را با اسکن `turbo` و `balanced` امتحان می‌کند (تأخیر = میانه‌ی ۳ درخواست). برنده ذخیره می‌شود و تونل با آن دوباره وصل می‌شود.
- در این چند دقیقه تونل قطع و وصل می‌شود؛ «لغو جستجو» متوقفش می‌کند (در صورت لغو، برنده اعمال نمی‌شود).
- اگر هیچ کاندیدی وصل نشود، به آخرین کانفیگ سالم برمی‌گردد.
- مهلت هر کاندید: `BEST_TIMEOUT_SEC` (پیش‌فرض ۴۵ ثانیه).

### پایش
کارت سلامت وضعیت watchdog، تعداد ری‌استارت‌ها، آخرین بررسی، دلیل آخرین قطعی و دکمه‌ی «ارسال اعلان آزمایشی» را نشان می‌دهد.

<a id="fa-clients"></a>
## اتصال کلاینت‌ها

| می‌خواهید… | از کدام لینک | کجا وارد کنید |
| --- | --- | --- |
| تلگرام | لینک یک‌لمسی `https://t.me/socks?...` (دکمه‌ی «افزودن به تلگرام») | با کلیک روی لینک، پراکسی اضافه می‌شود |
| اندروید / iOS / دسکتاپ (v2rayNG، Streisand، Shadowrocket، Nekoray و مشابه) | `socks://`، `ss://`، `vless://`، `trojan://` | Import from clipboard / Add from URL |
| تنظیم دستی | سرور، پورت، نام کاربری، رمز از بلوک کپی | تنظیمات پراکسی برنامه یا سیستم‌عامل |

کدام لینک را انتخاب کنم؟
- **رمزنگاری‌شده و توصیه‌شده:** Shadowsocks، VLESS+WS+TLS، Trojan+WS+TLS.
- **SOCKS5 و HTTP CONNECT** رمزنگاری ندارند؛ رمز و ترافیک بین کلاینت و رله به‌صورت متن ساده می‌رود (در پنل با برچسب unencrypted مشخص شده). برای تلگرام راحت است ولی روی شبکه‌های ناامن توصیه نمی‌شود.
- VLESS/Trojan شبیه HTTPS عادی روی ۴۴۳ دیده می‌شود و در شبکه‌های سخت‌گیر معمولاً بهتر عمل می‌کند.

تست از ترمینال:
```bash
curl --socks5-hostname HOST:PORT --proxy-user USER:PASS https://www.cloudflare.com/cdn-cgi/trace
```
خروجی باید `ip=` و `warp=` را نشان دهد.

<a id="fa-relays"></a>
## رله‌ها: راه‌اندازی تک‌تک
هر رله فقط وقتی فعال می‌شود که متغیرهای لازمش تنظیم باشد.

| رله | آدرس | حداقل تنظیم |
| --- | --- | --- |
| TCP Railway | ثابت | `RELAY_PORT` + فعال‌کردن TCP Proxy |
| TCP روی VPS شخصی | ثابت | `RELAY_PORT` + `RELAY_PUBLIC_HOST` + `RELAY_PUBLIC_PORT` |
| دامنه‌ی پنل (WS) | ثابت (HTTPS/۴۴۳) | پیش‌فرض روشن؛ نیاز به دامنه‌ی HTTP پنل |

### Railway TCP Proxy و دامنه‌ی پنل
در بخش [Railway](#fa-railway) توضیح داده شد. مسیر WebSocket پیش‌فرض `/ws/<۱۲ کاراکتر hex>` است که از رمز اشتراک مشتق می‌شود؛ برای مسیر دلخواه `INBOUND_WS_PATH=/my-secret-path` بگذارید. برای خاموش‌کردن: `INBOUND_WS=off`، یا فقط یکی: `INBOUND_WS=vless` / `trojan`. خارج از Railway/Render: `INBOUND_PUBLIC_HOST`، `INBOUND_PUBLIC_PORT`، `INBOUND_TLS`.

### پروتکل‌های gateway
`SHARE_PROTOCOLS=socks,http,ss` (پیش‌فرض) تعیین می‌کند هر پورت TCP کدام پروتکل‌ها را بپذیرد. رمز Shadowsocks همان رمز اشتراک است و رمزگذار با `SS_CIPHER` (`chacha20-ietf-poly1305` پیش‌فرض، `aes-256-gcm`، `aes-128-gcm`) انتخاب می‌شود.

<a id="fa-stability"></a>
## پایداری
- **ذخیره‌ی تنظیمات:** `tunnel-config.json` در `TMPDIR/.aether` (آخرین گزینه‌ها، `lastGood`، برنده‌ی بهترین کانفیگ)؛ تنظیمات اشتراک در `share-settings.json` و آخرین لینک‌های اعلام‌شده در `share-uris.json` (دسترسی ۰۶۰۰).
- **AUTO_START=1:** بعد از هر ری‌استارت پنل، تونل با تنظیمات ذخیره‌شده وصل می‌شود؛ با `SHARE_AUTO=1` رله‌ها هم روشن می‌شوند.
- **Watchdog** هر ۵ ثانیه وضعیت را می‌سنجد و هر ۳۰ ثانیه یک درخواست واقعی از داخل تونل به Cloudflare می‌زند. ری‌استارت با backoff ۲، ۴، ۸، … تا ۳۰۰ ثانیه در این حالت‌ها انجام می‌شود:
  - پروسه مرده باشد،
  - ۳ health check پشت‌سرهم شکست بخورد،
  - بیش از ۵ دقیقه در حالت اسکن/اتصال گیر کند.
  بعد از ۳ استارت ناموفق پشت‌سرهم، به آخرین کانفیگ سالم برمی‌گردد. کانفیگی «سالم» ثبت می‌شود که حداقل ۶۰ ثانیه پایدار وصل مانده باشد.
- Watchdog فقط وقتی تونل را «خواسته‌اید» عمل می‌کند؛ با «قطع» دستی دخالت نمی‌کند و در زمان «بهترین کانفیگ» کنار می‌ایستد.
- هر رله مستقل retry می‌شود (۳، ۵، ۱۰، ۲۰، ۳۰ ثانیه).

<a id="fa-notify"></a>
## اعلان‌ها
- **Webhook:** `NOTIFY_WEBHOOK_URL`؛ درخواست POST با JSON `{source,event,text,content,ts,data}` (`text` برای Slack و `content` برای Discord).
- **تلگرام:** در BotFather ربات بسازید، به ربات یک پیام بدهید، `chat_id` را پیدا کنید و `NOTIFY_TELEGRAM_BOT_TOKEN` و `NOTIFY_TELEGRAM_CHAT_ID` را ست کنید.
- **رویدادها** (`NOTIFY_EVENTS`، پیش‌فرض همه): `tunnel_down`، `subscription_changed`، `relay_error`.
- پیام تکراری تا `NOTIFY_COOLDOWN_SEC` (پیش‌فرض ۳۰۰) ارسال نمی‌شود.
- با دکمه‌ی «ارسال اعلان آزمایشی» تنظیمات را امتحان کنید.
- ⚠️ پیام `subscription_changed` شامل **نام کاربری و رمز رله** است؛ فقط به کانال‌هایی بفرستید که خودتان کنترل می‌کنید.

<a id="fa-env"></a>
## مرجع کامل متغیرهای محیطی
نمونه‌ی کامل و توضیح‌دار: `.env.example`.

**پایه**

| متغیر | پیش‌فرض | توضیح |
| --- | --- | --- |
| `PANEL_USER`، `PANEL_PASSWORD` | — | **الزامی.** خالی = ۵۰۳ |
| `PORT` | 3000 | پورت پنل |
| `HOSTNAME_BIND` | 0.0.0.0 | آدرس bind پنل |
| `TMPDIR` | سیستم | محل داده‌ها؛ روی Volume بگذارید |
| `PERSISTENCE_OK` | — | `1` = هشدار ماندگاری نمایش داده نشود |
| `AUTO_START` | — | `1` = اتصال خودکار تونل بعد از راه‌اندازی |
| `AETHER_BIN` | در Docker تنظیم است | مسیر باینری |
| `AETHER_VERSION` | در Docker `v1.5.0` | نسخه‌ی پین‌شده برای installer داخل پنل |

**اشتراک و gateway**

| متغیر | پیش‌فرض | توضیح |
| --- | --- | --- |
| `SHARE_USERNAME`، `SHARE_PASSWORD` | تصادفی | مقدار اولیه (تا قبل از ذخیره از رابط) |
| `SHARE_AUTO` | — | `1` = رله‌ها همراه تونل روشن شوند |
| `SHARE_PROTOCOLS` | `socks,http,ss` | پروتکل‌های gateway |
| `SS_CIPHER` | `chacha20-ietf-poly1305` | رمزگذار Shadowsocks |
| `GATEWAY_PORT` | — | پورت محلی ثابت gateway (اختیاری) |

**رله‌ها**

| متغیر | توضیح |
| --- | --- |
| `RELAY_PORT`، `RELAY_BIND_HOST` (`0.0.0.0`) | رله‌ی TCP (Railway / VPS) |
| `RELAY_PUBLIC_HOST`، `RELAY_PUBLIC_PORT` | آدرس عمومی رله‌ی TCP (خارج از Railway) |
| `INBOUND_WS` (`vless,trojan` / `off`)، `INBOUND_WS_PATH`، `INBOUND_PUBLIC_HOST`، `INBOUND_PUBLIC_PORT`، `INBOUND_TLS` | VLESS/Trojan روی WebSocket |

**Watchdog و بهترین کانفیگ**

| متغیر | پیش‌فرض | توضیح |
| --- | --- | --- |
| `WATCHDOG_TICK_SEC` | 5 | فاصله‌ی tick |
| `WATCHDOG_INTERVAL_SEC` | 30 | فاصله‌ی health check |
| `WATCHDOG_MAX_FAILURES` | 3 | شکست متوالی تا ری‌استارت |
| `WATCHDOG_STUCK_SEC` | 300 | ری‌استارت اگر این‌قدر در اسکن/اتصال بماند |
| `WATCHDOG_BACKOFF_BASE_SEC` / `_MAX_SEC` | 2 / 300 | backoff نمایی |
| `WATCHDOG_FALLBACK_AFTER` | 3 | استارت ناموفق تا بازگشت به کانفیگ سالم |
| `WATCHDOG_STABLE_SEC` | 60 | اتصال پایدار این‌قدر = «کانفیگ سالم» |
| `WATCHDOG_PROBE_TIMEOUT_SEC` | 10 | مهلت هر health check |
| `BEST_TIMEOUT_SEC` | 45 | مهلت اتصال هر کاندید |

**اعلان**

| متغیر | پیش‌فرض |
| --- | --- |
| `NOTIFY_WEBHOOK_URL` | — |
| `NOTIFY_TELEGRAM_BOT_TOKEN`، `NOTIFY_TELEGRAM_CHAT_ID` | — |
| `NOTIFY_TELEGRAM_API` | `https://api.telegram.org` |
| `NOTIFY_EVENTS` | همه |
| `NOTIFY_COOLDOWN_SEC` | 300 |

مقدارهای `SHARE_*` فقط تا وقتی فایل تنظیمات ذخیره‌شده وجود ندارد استفاده می‌شوند.

<a id="fa-api"></a>
## API داخلی
همه‌ی مسیرها پشت Basic Auth هستند (به‌جز `/healthz`).

| مسیر | متد | کار |
| --- | --- | --- |
| `/healthz` | GET | سلامت سرویس (بدون رمز) |
| `/api/aether/status` | GET | وضعیت کامل |
| `/api/aether/start` · `/stop` | POST | شروع/توقف تونل |
| `/api/aether/test` | POST | تست اتصال (trace Cloudflare) |
| `/api/aether/install` | POST | نصب باینری Aether |
| `/api/aether/best` | POST / GET | شروع جستجو / وضعیت (محدودیت نرخ: ۸ درخواست در دقیقه) |
| `/api/aether/best/cancel` | POST | لغو جستجو |
| `/api/aether/share/start` · `/stop` | POST | روشن/خاموش‌کردن اشتراک |
| `/api/aether/share/settings` | POST | ذخیره‌ی تنظیمات اشتراک |
| `/api/aether/notify/test` | POST | اعلان آزمایشی |
| `/api/aether/boot` | POST | راه‌اندازی اولیه (خودکار؛ idempotent) |

<a id="fa-security"></a>
## امنیت
- رمز پنل و رمز اشتراک را **طولانی و تصادفی** بگذارید و پنل را فقط روی HTTPS باز کنید (Railway/Render خودکار HTTPS می‌دهند).
- ورود ناموفق به پنل محدود می‌شود: ۲۰ تلاش در ۱۰ دقیقه برای هر IP و بعد ۱۰ دقیقه بلاک. gateway رله هم پاسخ ورود اشتباه را عمداً کند می‌دهد و پروب‌های Shadowsocks بی‌صدا قطع می‌شوند.
- پورت `RELAY_PORT` از اینترنت در دسترس است؛ تنها محافظ آن نام کاربری/رمز است. از رمز قوی استفاده کنید و در صورت نیاز فقط Shadowsocks را فعال کنید: `SHARE_PROTOCOLS=ss`.
- مسیر WebSocket (VLESS/Trojan) عمداً Basic Auth ندارد (کلاینت‌ها نمی‌توانند) و فقط با مسیر مخفی و UUID/رمز مشتق‌شده از رمز اشتراک محافظت می‌شود؛ آن را لو ندهید.
- SOCKS5 و HTTP CONNECT رمزنگاری‌شده نیستند؛ برای شبکه‌های ناامن از Shadowsocks/VLESS/Trojan استفاده کنید.
- اعلان `subscription_changed` رمز را شامل می‌شود؛ فقط به کانال خصوصی بفرستید.

<a id="fa-trouble"></a>
## عیب‌یابی

| مشکل | علت و راه‌حل |
| --- | --- |
| پنل ۵۰۳ می‌دهد | `PANEL_USER` و `PANEL_PASSWORD` را تنظیم کنید |
| پنل ۴۲۹ می‌دهد | ورود ناموفق زیاد؛ ۱۰ دقیقه صبر کنید |
| بنر «Settings and WARP identity…» | Volume روی `/data` بسازید و `TMPDIR=/data/tmp` بگذارید (یا `PERSISTENCE_OK=1`) |
| «فایل اجرایی Aether پیدا نشد» | در Docker نباید رخ دهد؛ کارت نصب را بزنید یا `AETHER_BIN` را بررسی کنید |
| تونل در scanning/connecting گیر می‌کند | حالت اسکن یا noize را عوض کنید، «بهترین کانفیگ» را بزنید؛ watchdog بعد از ۵ دقیقه خودش ری‌استارت می‌کند |
| «ابتدا تونل را وصل کنید» هنگام ساخت آدرس | اشتراک فقط وقتی تونل connected است شروع می‌شود |
| «No relay is enabled…» | حداقل یک رله را فعال کنید (`RELAY_PORT` یا دامنه‌ی پنل) |
| رله‌ی Railway «pending» | TCP Proxy را فعال کنید یا `RELAY_PUBLIC_HOST/PORT` بدهید |
| رله‌ی Railway «error» | `RELAY_PORT` با `PORT` یا `PORT+1` یکی است یا اشغال است؛ عوضش کنید |
| VLESS/Trojan وصل نمی‌شود | اشتراک باید روشن باشد؛ دامنه‌ی HTTPS و مسیر درست باشد؛ پشت reverse proxy هدر Upgrade پاس داده شود |
| «Too many requests» | محدودیت نرخ APIهای سنگین؛ چند ثانیه صبر کنید |
| بعد از ری‌استارت تونل وصل نمی‌شود | `AUTO_START=1` و وجود باینری را بررسی کنید |
| اعلان نمی‌رسد | «ارسال اعلان آزمایشی» را بزنید؛ توکن/chat_id یا Webhook را چک کنید |

<a id="fa-dev"></a>
## توسعه، تست و CI
```bash
pnpm install
pnpm dev            # http://localhost:3000 (همراه PANEL_USER و PANEL_PASSWORD)
pnpm typecheck
npm test            # فقط Node 22+؛ از aether/curl ساختگی استفاده می‌کند
pnpm dev:ws         # اجرای server.mjs برای آزمایش WebSocket inbound
```
- GitHub Actions (`.github/workflows/ci.yml`): typecheck ← تست‌ها ← بیلد Docker.
- تست‌ها: پیکربندی رله‌ها، لینک‌ها، پروتکل‌های gateway (SOCKS5/HTTP/Shadowsocks)، inbound، AUTO_START، watchdog، بهترین کانفیگ و rate limit.
- ساختار: `web/lib/` منطق سرور، `web/app/api/aether/` مسیرهای API، `web/components/` رابط، `web/server.mjs` ورودی تولید، `tests/` تست‌ها.

---

<a id="en"></a>
# 🇬🇧 English

## Contents
1. [What is this?](#en-what)
2. [Features](#en-features)
3. [Architecture](#en-arch)
4. [Quick start (5 minutes)](#en-quick)
5. [Deploy on Railway (step by step)](#en-railway)
6. [Deploy on Render](#en-render)
7. [Deploy on a VPS with Docker / Compose](#en-vps)
8. [First login and panel settings](#en-panel)
9. [Connecting clients](#en-clients)
10. [Relays: setting each one up](#en-relays)
11. [Stability: watchdog, persisted config, AUTO_START](#en-stability)
12. [Notifications](#en-notify)
13. [Full environment reference](#en-env)
14. [Internal API](#en-api)
15. [Security](#en-security)
16. [Troubleshooting](#en-trouble)
17. [Development, tests and CI](#en-dev)

<a id="en-what"></a>
## What is this?
[Aether](https://github.com/CluvexStudio/aether) is a Cloudflare-based tunnel client that only opens a SOCKS5 proxy on `127.0.0.1:1819` **inside the same machine**. This Next.js panel:

1. Runs and manages Aether (start/stop, live logs, connection test, protocol and scan-mode selection).
2. Puts a **username/password gateway** in front of it and publishes it through several relays, giving you a public `host:port` that your phone or computer connects to.
3. **Keeps the tunnel alive** (watchdog), finds the best config and notifies you when something breaks.

<a id="en-features"></a>
## Features
- One-button start/stop; protocol (MASQUE, WireGuard, Gool, MiM), transport (h2/h3), scan mode, IP version, noize, port, HTTP proxy, quick reconnect
- Live status, selected gateway, exit IP/country, latency, uptime, logs and a connection test
- **2 independent relays:** TCP relay (Railway TCP Proxy or your personal VPS) and the panel domain (WebSocket on 443)
- **Link types:** SOCKS5 (`socks://`, `socks5://`), one-tap Telegram link, Shadowsocks AEAD (`ss://`), HTTP CONNECT, VLESS+WS+TLS and Trojan+WS+TLS
- **Watchdog** with exponential backoff and automatic fallback to the last known-good config
- **Find best config:** tries protocol × transport × scan, saves the winner
- Settings persisted to disk, plus `AUTO_START=1` to reconnect after every restart
- Webhook (Slack/Discord/…) and Telegram bot notifications
- Security: Basic Auth on the whole panel, failed-login rate limiting, deliberately slowed brute-force on the gateway
- Responsive, RTL-aware UI

<a id="en-arch"></a>
## Architecture
```
                       ┌─► TCP relay (Railway / VPS) ─┐
client ──► relays ─────┤
                       └─► panel domain (WS/443) ─────┤
                                   │
                                   ▼
        gateway (username/password) — protocol sniffed from the first bytes:
            SOCKS5 (user/pass) | HTTP CONNECT | Shadowsocks AEAD
                                   │
                                   ▼
          local Aether SOCKS5 (127.0.0.1:1819, no auth) ──► Cloudflare
```
- Every relay is **independent**: own phase, process, retry timer and error; one failing never affects another.
- VLESS/Trojan is served on the panel's own HTTP port; the Railway/Render edge terminates TLS on 443, so it looks like ordinary HTTPS (TCP only; no UDP or mux).
- The Aether version is **pinned** in the Dockerfile (`ARG AETHER_VERSION=v1.5.0`) and its checksum is verified at build time.

<a id="en-quick"></a>
## Quick start (5 minutes)
```bash
git clone <your-repo-url> aether-panel && cd aether-panel
docker build -t aether-panel .
docker run -d --name aether-panel --restart unless-stopped -p 3000:3000 \
  -e PANEL_USER=admin \
  -e PANEL_PASSWORD='a-long-random-password' \
  -e AUTO_START=1 \
  -v aether-data:/data -e TMPDIR=/data/tmp \
  aether-panel
```
1. Open `http://localhost:3000` and sign in with `PANEL_USER` / `PANEL_PASSWORD`.
2. Press the big connect button and wait for **connected**.
3. Press the share button and import the link in your client.

> WebSocket links work through the panel domain. For the TCP relay set `RELAY_PORT` on Railway (TCP Proxy) or on your own VPS.

<a id="en-railway"></a>
## Deploy on Railway (step by step)
Railway is the best fit: it gives you both an HTTPS domain (for VLESS/Trojan) and a TCP Proxy with a stable `host:port`.

### 1) Create the service
1. Fork/push the repo to your GitHub.
2. In Railway: **New Project → Deploy from GitHub repo**, pick the repo. The root `Dockerfile` is auto-detected; no Start Command is needed (`server.mjs` runs via `pnpm start`; do not override it).
3. Open **Variables** and set:

| Variable | Value | Notes |
| --- | --- | --- |
| `PANEL_USER` | `admin` | **required** |
| `PANEL_PASSWORD` | long password | **required** (the panel returns 503 without it) |
| `TMPDIR` | `/data/tmp` | after adding the volume (step 2) |
| `AUTO_START` | `1` | reconnect after every restart |
| `SHARE_AUTO` | `1` | start the relays together with the tunnel |
| `SHARE_USERNAME` | e.g. `myuser` | 3–32 chars from `A-Za-z0-9._~-` |
| `SHARE_PASSWORD` | 8+ chars | 8–64 chars from `A-Za-z0-9._~-` |
| `RELAY_PORT` | `1080` | enables the TCP Proxy relay (any free port except `PORT` and `PORT+1`) |

4. **Settings → Networking → Generate Domain** for the panel. The domain's target port must equal the service `PORT` (Railway injects `PORT`; the image default is 3000).

### 2) Volume (persistence)
**Settings → Volumes → New Volume** mounted at `/data`, then set `TMPDIR=/data/tmp`. Without it, each restart wipes (and the panel warns `Settings and WARP identity will be lost on restart.`):
- tunnel settings and known-good/winner configs,
- share username/password,
- the WARP identity,
- downloaded relay binaries.

### 3) TCP Proxy (stable `host:port`)
1. **Settings → Networking → TCP Proxy → Add**.
2. Set "Application port" to your `RELAY_PORT` (e.g. `1080`).
3. Railway gives a stable `host:port` (e.g. `roundhouse.proxy.rlwy.net:12345`) and injects `RAILWAY_TCP_PROXY_DOMAIN`, `RAILWAY_TCP_PROXY_PORT` and `RAILWAY_TCP_APPLICATION_PORT`. The panel reads them; nothing to copy.
4. **Redeploy**.
5. If `RELAY_PORT` is unset but a TCP Proxy exists, `RAILWAY_TCP_APPLICATION_PORT` is used.

### 4) Use the panel
1. Open the Railway domain and sign in.
2. Connect the tunnel (or let `AUTO_START=1` do it).
3. Press the share button (or rely on `SHARE_AUTO=1`).
4. The "Railway relay" and "Panel domain" blocks show your links.

### Post-deploy checklist
- [ ] `https://<domain>/healthz` returns `ok` (no auth)
- [ ] Panel login works
- [ ] The "Settings and WARP identity…" banner is gone
- [ ] Status is **connected** and the exit IP is shown
- [ ] The Railway relay is **on** (not pending/error)

<a id="en-render"></a>
## Deploy on Render
1. **New → Web Service**, runtime **Docker**, connect the repo.
2. Use a **paid** instance type (the free plan sleeps and drops the tunnel).
3. Environment: `PANEL_USER`, `PANEL_PASSWORD`, optionally `AUTO_START=1`, `SHARE_AUTO=1`.
4. **Advanced → Health Check Path:** `/healthz`.
5. (Recommended) A disk at `/data` plus `TMPDIR=/data/tmp`.
6. The `*.onrender.com` domain is picked up automatically for VLESS/Trojan (`RENDER_EXTERNAL_HOSTNAME`).

> Render has **no TCP Proxy.** Run the TCP relay on Railway or your own VPS; on Render only the WebSocket relay works.

<a id="en-vps"></a>
## Deploy on a VPS with Docker / Compose
`docker-compose.yml`:
```yaml
services:
  aether-panel:
    build: .
    restart: unless-stopped
    ports:
      - "3000:3000"          # panel (put it behind Nginx/Caddy with HTTPS)
      - "1080:1080"          # direct TCP relay (when using RELAY_PORT)
    environment:
      PANEL_USER: admin
      PANEL_PASSWORD: ${PANEL_PASSWORD}
      TMPDIR: /data/tmp
      AUTO_START: "1"
      SHARE_AUTO: "1"
      SHARE_USERNAME: myuser
      SHARE_PASSWORD: ${SHARE_PASSWORD}
      RELAY_PORT: "1080"
      RELAY_PUBLIC_HOST: YOUR.SERVER.IP.OR.DOMAIN   # required outside Railway
      RELAY_PUBLIC_PORT: "1080"
      INBOUND_PUBLIC_HOST: panel.example.com        # your HTTPS domain for VLESS/Trojan
    volumes:
      - aether-data:/data
volumes:
  aether-data:
```
- For VLESS/Trojan put a TLS reverse proxy in front that forwards the **WebSocket Upgrade** to port 3000 (in Nginx set the `Upgrade` and `Connection "upgrade"` headers).
- Firewall: `RELAY_PORT` is reachable from the internet and the username/password is its only protection; use strong credentials.
- Build and run: `PANEL_PASSWORD=... SHARE_PASSWORD=... docker compose up -d --build`.

<a id="en-panel"></a>
## First login and panel settings

### Connection card and tunnel options
Options can be changed only while the tunnel is **off** and are saved on every start.

| Option | Values | Notes |
| --- | --- | --- |
| Protocol | `masque` · `wg` · `gool` · `mim` | default `masque` |
| Transport | `h2` · `h3` | not used with `wg` |
| Scan mode | `turbo` · `balanced` · `thorough` · `verified` · `ironclad` | `turbo` fastest; `verified/ironclad` slowest and most thorough |
| IP version | `4` · `6` · `dual` | default 4 |
| noize | `default` · `off` · `light` · `firewall` · `balanced` · `gfw` · `aggressive` | for censorship evasion; try another profile if it won't connect |
| Port | 1024–65534 | default 1819 (internal only) |
| HTTP proxy | on/off | on `port + 1` (default 1820) |
| Quick reconnect | on/off | `--quick-reconnect` |

If the Aether binary is missing (outside Docker) an install card appears; the button downloads the pinned release and verifies its checksum.

### Share card (outside access)
- Share button: starts the gateway and relays. Works only while the tunnel is **connected**.
- "Share settings": username, password and "auto start". Editable only while sharing is **off**, so a live link never changes under you.
  - username: 3–32 chars, password: 8–64 chars, only `A-Za-z0-9._~-`
- Priority: **file saved from the UI** → `SHARE_*` variables → random values (then saved so they stay stable).
- Every running relay shows its links: `socks://`, `socks5://`, Telegram link, `ss://`, `http://`, `vless://`, `trojan://` and a **copy-ready block** with a "Copy all" button.

### Find best config
Press the button; by default every protocol and transport is tried with the `turbo` and `balanced` scans (latency = median of 3 requests). The winner is saved and the tunnel reconnects with it.
- The tunnel drops for a few minutes meanwhile; Cancel stops the sweep (the winner is not applied if you cancel).
- If nothing connects, it falls back to the last known-good config.
- Per-candidate timeout: `BEST_TIMEOUT_SEC` (default 45 s).

### Monitoring
The health card shows watchdog state, restart count, last check, the last outage reason and a "send test notification" button.

<a id="en-clients"></a>
## Connecting clients

| You want… | Use this link | Where to enter it |
| --- | --- | --- |
| Telegram | one-tap `https://t.me/socks?...` ("Add to Telegram") | clicking it adds the proxy |
| Android / iOS / desktop (v2rayNG, Streisand, Shadowrocket, Nekoray and similar) | `socks://`, `ss://`, `vless://`, `trojan://` | Import from clipboard / Add from URL |
| Manual setup | server, port, user, password from the copy block | the app's or OS proxy settings |

Which link should I pick?
- **Encrypted, recommended:** Shadowsocks, VLESS+WS+TLS, Trojan+WS+TLS.
- **SOCKS5 and HTTP CONNECT are not encrypted;** credentials and traffic between client and relay travel in clear text (marked "unencrypted" in the panel). Convenient for Telegram, not recommended on untrusted networks.
- VLESS/Trojan looks like ordinary HTTPS on 443 and usually fares better on restrictive networks.

Test from a terminal:
```bash
curl --socks5-hostname HOST:PORT --proxy-user USER:PASS https://www.cloudflare.com/cdn-cgi/trace
```
The output should include `ip=` and `warp=`.

<a id="en-relays"></a>
## Relays: setting each one up

| Relay | Tier | Address | Minimum setup |
| --- | --- | --- | --- |
| TCP Railway | fixed | `RELAY_PORT` + enable TCP Proxy |
| TCP on a personal VPS | fixed | `RELAY_PORT` + `RELAY_PUBLIC_HOST` + `RELAY_PUBLIC_PORT` |
| Panel domain (WS) | fixed (HTTPS/443) | on by default; needs the panel's HTTP domain |

### Railway TCP Proxy and panel domain
Covered in [Railway](#en-railway). The default WebSocket path is `/ws/<12 hex chars>` derived from the share password; set `INBOUND_WS_PATH=/my-secret-path` for a custom one. Disable with `INBOUND_WS=off`, or keep one: `INBOUND_WS=vless` / `trojan`. Outside Railway/Render set `INBOUND_PUBLIC_HOST`, `INBOUND_PUBLIC_PORT`, `INBOUND_TLS`.

### Gateway protocols
`SHARE_PROTOCOLS=socks,http,ss` (default) sets which protocols every TCP port accepts. The Shadowsocks password is the share password and the cipher is chosen with `SS_CIPHER` (`chacha20-ietf-poly1305` default, `aes-256-gcm`, `aes-128-gcm`).

<a id="en-stability"></a>
## Stability
- **Persisted config:** `tunnel-config.json` in `TMPDIR/.aether` (last options, `lastGood`, best-config winner); share settings in `share-settings.json` and last announced links in `share-uris.json` (mode 0600).
- **AUTO_START=1:** after every panel restart the tunnel reconnects with the saved config; with `SHARE_AUTO=1` the relays come back too.
- **Watchdog** ticks every 5 s and sends a real request through the tunnel to Cloudflare every 30 s. It restarts with backoff 2, 4, 8 … up to 300 s when:
  - the process died,
  - 3 consecutive health checks failed,
  - it has been stuck scanning/connecting for over 5 minutes.
  After 3 failed starts in a row it falls back to the last known-good config. A config counts as "good" after staying connected for at least 60 s.
- It acts only while you want the tunnel up; a manual stop is respected, and it stays out of the way during best-config sweeps.
- Each relay retries on its own (3, 5, 10, 20, 30 s).

<a id="en-notify"></a>
## Notifications
- **Webhook:** `NOTIFY_WEBHOOK_URL`; POST JSON `{source,event,text,content,ts,data}` (`text` for Slack, `content` for Discord).
- **Telegram:** create a bot with BotFather, message it, find your `chat_id`, and set `NOTIFY_TELEGRAM_BOT_TOKEN` and `NOTIFY_TELEGRAM_CHAT_ID`.
- **Events** (`NOTIFY_EVENTS`, default all): `tunnel_down`, `subscription_changed`, `relay_error`.
- Repeats are suppressed for `NOTIFY_COOLDOWN_SEC` (default 300).
- Use "send test notification" to verify your setup.
- ⚠️ `subscription_changed` messages contain the **relay credentials**; only use channels you control.

<a id="en-env"></a>
## Full environment reference
Full commented sample: `.env.example`.

**Core**

| Variable | Default | Description |
| --- | --- | --- |
| `PANEL_USER`, `PANEL_PASSWORD` | — | **Required.** Empty → 503 |
| `PORT` | 3000 | panel port |
| `HOSTNAME_BIND` | 0.0.0.0 | panel bind address |
| `TMPDIR` | OS temp | data directory; put it on a volume |
| `PERSISTENCE_OK` | — | `1` hides the persistence warning |
| `AUTO_START` | — | `1` starts the tunnel on boot |
| `AETHER_BIN` | preset in Docker | binary path |
| `AETHER_VERSION` | `v1.5.0` in Docker | pins the in-panel installer |

**Sharing and gateway**

| Variable | Default | Description |
| --- | --- | --- |
| `SHARE_USERNAME`, `SHARE_PASSWORD` | random | initial values (until saved from the UI) |
| `SHARE_AUTO` | — | `1` starts relays with the tunnel |
| `SHARE_PROTOCOLS` | `socks,http,ss` | gateway protocols |
| `SS_CIPHER` | `chacha20-ietf-poly1305` | Shadowsocks cipher |
| `GATEWAY_PORT` | — | fixed local gateway port (optional) |

**Relays**

| Variable | Description |
| --- | --- |
| `RELAY_PORT`, `RELAY_BIND_HOST` (`0.0.0.0`) | TCP relay (Railway / VPS) |
| `RELAY_PUBLIC_HOST`, `RELAY_PUBLIC_PORT` | public address of the TCP relay (outside Railway) |
| `INBOUND_WS` (`vless,trojan` / `off`), `INBOUND_WS_PATH`, `INBOUND_PUBLIC_HOST`, `INBOUND_PUBLIC_PORT`, `INBOUND_TLS` | VLESS/Trojan over WebSocket |

**Watchdog and best-config**

| Variable | Default | Description |
| --- | --- | --- |
| `WATCHDOG_TICK_SEC` | 5 | tick period |
| `WATCHDOG_INTERVAL_SEC` | 30 | health-check period |
| `WATCHDOG_MAX_FAILURES` | 3 | consecutive failures before restart |
| `WATCHDOG_STUCK_SEC` | 300 | restart if stuck scanning/connecting this long |
| `WATCHDOG_BACKOFF_BASE_SEC` / `_MAX_SEC` | 2 / 300 | exponential backoff |
| `WATCHDOG_FALLBACK_AFTER` | 3 | failed starts before falling back |
| `WATCHDOG_STABLE_SEC` | 60 | connected this long = known-good |
| `WATCHDOG_PROBE_TIMEOUT_SEC` | 10 | per health-check timeout |
| `BEST_TIMEOUT_SEC` | 45 | per-candidate connect timeout |

**Notifications**

| Variable | Default |
| --- | --- |
| `NOTIFY_WEBHOOK_URL` | — |
| `NOTIFY_TELEGRAM_BOT_TOKEN`, `NOTIFY_TELEGRAM_CHAT_ID` | — |
| `NOTIFY_TELEGRAM_API` | `https://api.telegram.org` |
| `NOTIFY_EVENTS` | all |
| `NOTIFY_COOLDOWN_SEC` | 300 |

`SHARE_*` values are used only while no saved settings file exists.

<a id="en-api"></a>
## Internal API
All routes are behind Basic Auth (except `/healthz`).

| Route | Method | Purpose |
| --- | --- | --- |
| `/healthz` | GET | service health (no auth) |
| `/api/aether/status` | GET | full status |
| `/api/aether/start` · `/stop` | POST | start/stop the tunnel |
| `/api/aether/test` | POST | connection test (Cloudflare trace) |
| `/api/aether/install` | POST | install the Aether binary |
| `/api/aether/best` | POST / GET | start sweep / status (rate limit: 8 requests per minute) |
| `/api/aether/best/cancel` | POST | cancel the sweep |
| `/api/aether/share/start` · `/stop` | POST | turn sharing on/off |
| `/api/aether/share/settings` | POST | save share settings |
| `/api/aether/notify/test` | POST | test notification |
| `/api/aether/boot` | POST | initial boot (automatic; idempotent) |

<a id="en-security"></a>
## Security
- Use **long random passwords** for the panel and the share credentials, and expose the panel over HTTPS only (Railway/Render provide it automatically).
- Failed panel logins are rate-limited: 20 attempts per 10 minutes per IP, then a 10-minute block. The relay gateway deliberately slows down wrong logins and silently drops Shadowsocks probes.
- `RELAY_PORT` is reachable from the internet and the username/password is its only protection. Use strong credentials and, if you like, enable only Shadowsocks: `SHARE_PROTOCOLS=ss`.
- The WebSocket path (VLESS/Trojan) intentionally has no Basic Auth (clients can't send it) and is protected only by the secret path and the UUID/password derived from the share password; do not leak them.
- SOCKS5 and HTTP CONNECT are not encrypted; use Shadowsocks/VLESS/Trojan on untrusted networks.
- `subscription_changed` notifications include the credentials; send them to private channels only.

<a id="en-trouble"></a>
## Troubleshooting

| Problem | Cause and fix |
| --- | --- |
| Panel returns 503 | set `PANEL_USER` and `PANEL_PASSWORD` |
| Panel returns 429 | too many failed logins; wait 10 minutes |
| "Settings and WARP identity…" banner | add a volume at `/data` and set `TMPDIR=/data/tmp` (or `PERSISTENCE_OK=1`) |
| "Aether binary not found" | shouldn't happen in Docker; press the install card or check `AETHER_BIN` |
| Tunnel stuck in scanning/connecting | change scan mode or noize, run "Find best config"; the watchdog restarts it after 5 minutes |
| "Connect the tunnel first" when sharing | sharing starts only while the tunnel is connected |
| "No relay is enabled…" | enable at least one relay (`RELAY_PORT` or the panel domain) |
| Railway relay "pending" | enable TCP Proxy or set `RELAY_PUBLIC_HOST/PORT` |
| Railway relay "error" | `RELAY_PORT` equals `PORT` or `PORT+1`, or is in use; change it |
| VLESS/Trojan won't connect | sharing must be on; HTTPS domain and path must be right; the reverse proxy must forward the Upgrade header |
| "Too many requests" | rate limit on heavy endpoints; wait a few seconds |
| Tunnel not up after restart | check `AUTO_START=1` and that the binary exists |
| No notifications | use "send test notification"; check token/chat_id or webhook |

<a id="en-dev"></a>
## Development, tests and CI
```bash
pnpm install
pnpm dev            # http://localhost:3000 (set PANEL_USER and PANEL_PASSWORD)
pnpm typecheck
npm test            # Node 22+ only; uses fake aether/curl
pnpm dev:ws         # run server.mjs to try the WebSocket inbound
```
- GitHub Actions (`.github/workflows/ci.yml`): typecheck → tests → Docker build.
- Tests cover relay config, links, gateway protocols (SOCKS5/HTTP/Shadowsocks), the inbound, AUTO_START, the watchdog, best-config and rate limiting.
- Layout: `web/lib/` server logic, `web/app/api/aether/` API routes, `web/components/` UI, `web/server.mjs` production entry point, `tests/` tests.

---

## License
See [LICENSE](LICENSE).
