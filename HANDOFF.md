# Handoff - 2026-04-23

## Repo state

- Local path: `D:\Dev\Tools\MetaTiktok video Convert`
- Remote: `https://github.com/thang081193-ctrl/Meta-Tiktok-video-convert.git`
- Branch used for this work: `main`
- Runtime smoke workspace used today: `workspace/smoke-run-1776943601214`
- Smoke summary: `workspace/smoke-run-1776943601214/smoke-summary.json`

## Completed in this round

### 1. Job restore / cleanup

- Completed jobs no longer restore after refresh/restart.
- `lastJobId` is cleared when a job becomes terminal.
- UI now exposes `Clear completed jobs`.
- Backend cleanup endpoint deletes terminal jobs from memory and removes their `jobs/`, `outputs/`, and `reports/` directories.

Key files:

- `public/app.js`
- `public/ui-model.js`
- `server/index.js`
- `server/lib/converter-service.js`

### 2. Strict no-crop ads-safe pipeline for built-ins

Built-in TikTok/Meta profiles were moved from heuristic smart-skip behavior to strict normalized export behavior.

Current built-in contract:

- always export fresh `.mp4`
- H.264 + AAC + `yuv420p` + `faststart`
- no crop in content-safe mode
- full frame must stay inside the target safe zone
- strict built-ins ignore `use original`
- strict built-ins require audio
- `meta_reels_9x16` now hard-blocks above `90s`

Key files:

- `server/lib/specs.js`
- `public/layout-core.js`
- `server/lib/classifier.js`
- `server/lib/converter-service.js`
- `server/lib/verifier.js`
- `public/app.js`

## Verified today

### Automated tests

Use:

```powershell
npx.cmd vitest run --pool=threads
```

Current expected result:

- `7` test files passed
- `32` tests passed

Added/updated coverage includes:

- strict built-ins always convert
- custom profiles still keep smart-skip/original passthrough behavior
- strict safe-zone layout clamping
- strict verifier failures for missing audio / safe-rect violations
- completed job cleanup behavior

### Real smoke test

Real ffmpeg-backed smoke ran against synthetic fixtures in an isolated workspace and produced these results:

1. `vertical_9x16_ready_tiktok_meta.mp4`
   - TikTok strict output: `PASS`
   - Meta Reels strict output: `PASS`
   - both outputs are normalized `.mp4`, `1080x1920`, `h264/aac`, `faststart=true`
2. `landscape_16x9_30fps_h264_aac.mp4`
   - TikTok strict output: `PASS`
   - Meta Feed strict output: `PASS`
   - no crop; `foregroundRect` remained inside `safeRect`
3. `no_audio.mp4`
   - TikTok strict output blocked before encode
   - expected error: strict target requires audio
4. `long_95s_vertical_aac.mp4`
   - Meta Reels strict output blocked before encode
   - expected error: duration exceeds `90s`

## Remaining work for next session

Main remaining item is visual/product QA, not core backend correctness.

### Recommended next steps

1. Browser smoke the preview/editor visually with real creative files.
2. Inspect whether current safe-zone percentages feel too conservative or too loose for real TikTok/Meta creatives.
3. Review copy in the UI for blocked reasons and strict-mode messaging.
4. Optionally add an explicit “strict built-in” badge in the target list / preview panel.
5. If needed later, consider trim support for strict targets, but this was intentionally not added in this round.

## Important assumptions currently encoded

- Built-ins are the only profiles covered by the strict “ads-safe” guarantee.
- Custom profiles stay in advanced/manual mode.
- Strict built-ins do not auto-trim and do not auto-add silent audio.
- “100% suitable” is implemented only for the parts the app can actually control:
  - exact output spec
  - no crop
  - conservative safe-zone fit
  - early blocking for audio/duration failures

## Useful files to open first next time

- `server/lib/specs.js`
- `public/layout-core.js`
- `server/lib/converter-service.js`
- `public/app.js`
- `workspace/smoke-run-1776943601214/smoke-summary.json`
