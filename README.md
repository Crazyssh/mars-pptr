# mars-pptr - Puppeteer Relay

Headless browser (Puppeteer + stealth) yang polling infoOrder ditznesia pakai
browser asli (biar lewatin Cloudflare sendiri), terus push hasilnya ke endpoint
Mars `/api/ingest`. Alternatif otomatis dari relay RDP manual - jalan di server
sendiri, beda domain dari Mars.

## Kenapa Puppeteer (bukan curl)?
- Browser asli jalanin JS challenge Cloudflare -> dapet cf_clearance sendiri.
- Stealth plugin nyamarin sinyal headless biar gak gampang kedeteksi bot.
- CATATAN: kalau IP server datacenter di-throttle Cloudflare, tetep bisa lambat.
  Idealnya jalan di server ber-IP residential.

## Setup
```bash
cd mars-pptr
npm install          # download Chromium (~200MB)
cp .env.example .env
nano .env            # isi cookie login + INGEST_URL + INGEST_SECRET
npm start
```

## Env penting
- `MARS_PHPSESSID`, `MARS_USER_ID`, `MARS_EXPIRES_AT` - cookie login ditznesia.
- `MARS_CF_CLEARANCE` - opsional, browser generate sendiri.
- `INGEST_URL` - endpoint Mars, contoh https://api.clowatch.com/api/ingest
- `INGEST_SECRET` - samain dgn INGEST_SECRET di .env Mars.
- `HEADLESS=true|false` - false buat debug (liat browsernya).
- `CHROME_PATH` - opsional, pakai Chrome sistem.

## Jalan di server (PM2)
```bash
npm i -g pm2
pm2 start "npm start" --name mars-pptr
pm2 save
```

## Deps sistem (Linux) buat Chromium headless
```bash
apt-get install -y \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0
```
