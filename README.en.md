# HaHaCode AI Image Worker

[简体中文](./README.md) | English

A lightweight AI image generation workspace built on Cloudflare Workers. It serves a static SPA with Workers Assets and proxies image generation requests through a Hono API route.

## Features

- Single-page image generation workspace
- Local browser API key storage
- Local browser session history
- Text-to-image and reference-image edit flow
- OpenAI Image and HaHaCode Nana image model support
- Responsive desktop/mobile layout
- Result preview, fullscreen preview, and download
- Cloudflare Workers Static Assets deployment

## Tech Stack

- TypeScript
- Hono
- Cloudflare Workers
- Cloudflare Workers Static Assets
- Wrangler
- Plain HTML/CSS/JavaScript frontend

## Project Structure

```text
.
├── public/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── logo.png
├── src/
│   └── index.ts
├── package.json
├── tsconfig.json
└── wrangler.jsonc
```

## How It Works

- Static frontend files are served from `public/` through Cloudflare Workers Assets.
- API calls under `/api/*` run through the Worker first.
- The browser stores the user's API key in `localStorage`.
- The frontend sends the API key in the `Authorization` header only when generating images.
- The Worker forwards requests to `BASE_URL`, which should be an OpenAI-compatible API base URL.

## Development

Install dependencies:

```bash
npm install
```

Start the local Worker:

```bash
npm run dev
```

Then open the local URL printed by Wrangler, usually:

```text
http://localhost:8787
```

Type-check:

```bash
npx tsc --noEmit
```

## Configuration

`wrangler.jsonc` contains the Worker and asset configuration:

```jsonc
{
  "vars": {
    "BASE_URL": "https://api.hahacode.com"
  }
}
```

For another OpenAI-compatible endpoint, change `BASE_URL`.

The API key is intentionally not stored as a Worker secret. Users enter their own key in the browser UI, and it is saved only in that browser's local storage.

## Deployment

Make sure you are logged in to Cloudflare:

```bash
npx wrangler login
```

Deploy:

```bash
npm run deploy
```

Wrangler will upload the Worker and static assets from `public/`.

## License

This project is open-sourced under the [MIT License](./LICENSE).
