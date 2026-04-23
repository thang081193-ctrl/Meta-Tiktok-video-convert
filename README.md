# Meta/TikTok Video Quality Converter

Standalone local web app for preparing source videos for Meta and TikTok ad placements.

## Run

```powershell
npm install
npm start
```

Open `http://localhost:4173`.

## What It Does

- Uploads and analyzes source videos with FFprobe.
- Classifies every video per target: `READY_EXACT`, `READY_ACCEPTED`, `CONVERT_RECOMMENDED`, `CONVERT_REQUIRED`, or `UNSUPPORTED`.
- Built-in TikTok/Meta ad targets run in strict no-crop mode and always render a fresh normalized MP4.
- Custom profiles keep Smart Skip behavior and can still use passthrough/original files when appropriate.
- Blocks strict built-in outputs early when the source cannot meet ad-safe rules, such as missing audio or Reels duration over the enforced limit.
- Verifies every output with FFprobe and writes JSON/HTML QA reports.
- Downloads individual outputs or one ZIP containing outputs and reports.

## Default Bundle Targets

- TikTok Vertical 9:16, `1080x1920`
- Meta Reels/Stories 9:16, `1080x1920`, strict `<= 90s`
- Meta Feed 4:5, `1080x1350`
- Meta Square 1:1, `1080x1080`

## Scripts

```powershell
npm test
npm run fixtures
```

`npm run fixtures` creates synthetic regression videos under `tests/fixtures`.

When running tests in this PowerShell environment, prefer:

```powershell
npx.cmd vitest run --pool=threads
```

## Runtime Data

Generated runtime files live in `workspace/`:

- `uploads/`
- `jobs/`
- `outputs/`
- `reports/`
- `tmp/`

This folder is ignored by git.
