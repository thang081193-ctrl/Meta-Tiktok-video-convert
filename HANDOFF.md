# Handoff - 2026-04-23

## Repo state

- Local path: `D:\Dev\Tools\MetaTiktok video Convert`
- Remote: `https://github.com/thang081193-ctrl/Meta-Tiktok-video-convert.git`
- Branch: `main`
- Latest app commit before this handoff: `6ede691 Initial standalone Meta/TikTok video converter`

## Current problem to pick up next

Completed jobs still reappear in the UI after refresh or restart.

This is happening by design in the current implementation:

1. Frontend stores and restores `lastJobId` from `localStorage`
2. Backend persists job manifests under `workspace/jobs/<jobId>/job.json`
3. Backend reloads persisted jobs on startup

## Code references

### Frontend restore path

- `public/app.js:53`
- `public/app.js:55`
- `public/app.js:948`

Relevant behavior:

- `init()` reads `localStorage.getItem('lastJobId')`
- frontend requests `/api/jobs/:id`
- terminal jobs are still displayed, even though polling only continues for non-terminal states
- new jobs write `lastJobId` back into storage

### Backend persisted jobs

- `server/lib/converter-service.js:75`
- `server/lib/converter-service.js:118`
- `server/lib/converter-service.js:605`

Relevant behavior:

- startup calls `loadPersistedJobs()`
- it reads every `workspace/jobs/<id>/job.json`
- each job manifest is restored into memory

### Cleanup TTL

- `server/config.js:16`
- `server/lib/converter-service.js:154`

Relevant behavior:

- job TTL is currently `24 * 60 * 60 * 1000`
- cleanup sweeps `uploads`, `tmp`, and `jobs`
- completed jobs can remain visible for up to 24 hours unless manually cleared

## Recommended implementation

Do both of these together:

### 1. Restore only active jobs

In `public/app.js`:

- during `init()`, after loading `/api/jobs/:id`
- if job status is `complete`, `failed`, or `cancelled`:
  - set `state.job = null`
  - call `localStorage.removeItem('lastJobId')`
- when polling transitions a running job into a terminal state:
  - clear `lastJobId` as well

Expected result:

- refresh/reopen restores only actively running jobs
- completed jobs do not keep sticking to the right panel

### 2. Add manual cleanup for completed jobs

Preferred UI behavior:

- add a `Clear completed jobs` action in the job panel

Backend options:

- `DELETE /api/jobs/completed`
- or `DELETE /api/jobs/:id`

Recommended rule:

- allow deleting only terminal jobs
- do not allow deleting a running job from the cleanup action

Expected backend behavior:

- remove in-memory entries
- delete `workspace/jobs/<jobId>`
- return updated state to the UI

## Recommended order of work

1. Stop restoring terminal jobs from `localStorage`
2. Add manual cleanup endpoint and UI action
3. Optionally reduce TTL if shorter history is preferred
4. Only after that, consider server-side filtering of completed jobs from any future history list

## QA checklist

### Running job restore

1. Create a job and keep it running
2. Refresh the page
3. Confirm the running job restores and polling resumes

### Completed job should not restore

1. Let a job reach `complete`
2. Refresh the page
3. Confirm the completed job no longer auto-appears
4. Confirm `lastJobId` is cleared from browser storage

### Clear completed jobs

1. Create several completed jobs
2. Trigger `Clear completed jobs`
3. Confirm the UI clears them
4. Confirm `workspace/jobs` no longer contains those job folders
5. Restart the server and confirm they do not come back

### Safety checks

1. Cancelled and failed jobs should also be treated as terminal
2. Running jobs must not be deleted by the cleanup action
3. ZIP, JSON, and QA HTML download should still work before cleanup is triggered

## Test command in this environment

Default `npm test` can fail here because PowerShell and the sandbox block the worker fork path used by Vitest.

Use:

```powershell
npx.cmd vitest run --pool=threads
```

Expected result before making more changes:

- `5` test files passed
- `19` tests passed

## Git notes

- Repo was initialized locally in this workspace and pushed to `origin/main`
- Current pushed app commit before this handoff: `6ede691`
- `git safe.directory` was already added for this workspace on this machine, so push should work

## Useful files to open first

- `public/app.js`
- `server/index.js`
- `server/lib/converter-service.js`
- `server/config.js`

## Suggested commit breakdown

1. `Stop restoring completed jobs`
2. `Add clear completed jobs action`

If local Git identity needs to be corrected for future commits, set it explicitly in this repo:

```powershell
git config --local user.name "Thang"
git config --local user.email "your-email@example.com"
```
