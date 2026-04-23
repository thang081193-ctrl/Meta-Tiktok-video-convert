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
- Uses Smart Skip by default so already-ready targets are copied into the bundle without transcoding.
- Converts only the targets that need conversion.
- Verifies every output with FFprobe and writes JSON/HTML QA reports.
- Downloads individual outputs or one ZIP containing outputs and reports.

## Default Bundle Targets

- TikTok Vertical 9:16, `1080x1920`
- Meta Reels/Stories 9:16, `1080x1920`
- Meta Feed 4:5, `1080x1350`
- Meta Square 1:1, `1080x1080`

## Scripts

```powershell
npm test
npm run fixtures
```

`npm run fixtures` creates synthetic regression videos under `tests/fixtures`.

## Runtime Data

Generated runtime files live in `workspace/`:

- `uploads/`
- `jobs/`
- `outputs/`
- `reports/`
- `tmp/`

This folder is ignored by git.
