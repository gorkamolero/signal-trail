# Signal Trail

Test whether your mobile connection can hold a video call while you move. Start a trail, keep the app open and walk, ride or drive. Signal Trail measures the connection you actually have along the way and scores how well it would hold a video call and an audio call.

## How it works

- Every five seconds it pings the server for latency, jitter and packet loss, and every 30 seconds it runs a small download and upload test.
- GPS tracks the distance, and each trail is named after its start and end places, looked up on OpenStreetMap.
- Each trail gets two scores, one for video calls and one for audio calls, built from latency, jitter, loss, speed and the number of dropouts.
- Your trails stay on the phone as your signal map, and the screen stays awake while a trail is recording.
- It installs as a web app.

## Stack

Next.js 16 on vinext (Vite) as a Cloudflare Worker, React 19 and Tailwind CSS 4. Built with Codex.

## Run it

Needs Node 22.13 or later.

```sh
npm install
npm run dev
```

The build and install scripts in `scripts/` target Linux and use GNU `timeout`.
