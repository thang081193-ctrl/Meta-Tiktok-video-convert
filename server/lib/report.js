import { writeFile } from 'fs/promises';
import path from 'path';
import { ensureDir, formatBytes, writeJson } from './file-utils.js';

export async function writeReports(job, reportDir) {
  await ensureDir(reportDir);
  const jsonPath = path.join(reportDir, `${job.id}__qa-report.json`);
  const htmlPath = path.join(reportDir, `${job.id}__qa-report.html`);
  await writeJson(jsonPath, buildJsonReport(job));
  await writeFile(htmlPath, buildHtmlReport(job), 'utf8');
  job.reportJsonPath = jsonPath;
  job.reportHtmlPath = htmlPath;
}

export function buildJsonReport(job) {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    options: job.options,
    assets: job.assets.map(asset => ({
      id: asset.id,
      originalName: asset.originalName,
      analysis: asset.analysis,
      classifications: asset.classifications,
    })),
    outputs: job.outputs.map(output => ({
      id: output.id,
      assetId: output.assetId,
      targetId: output.targetId,
      targetLabel: output.targetLabel,
      state: output.state,
      decision: output.decision,
      outputName: output.outputName,
      classification: output.classification,
      layoutOverride: output.layoutOverride,
      layoutResult: output.layoutResult,
      qa: output.qa,
      error: output.error,
      command: output.command,
    })),
  };
}

export function buildHtmlReport(job) {
  const rows = job.outputs.map(output => {
    const qaStatus = output.qa?.status || (output.error ? 'FAIL' : 'PENDING');
    const notes = [
      ...(output.qa?.issues || []),
      ...(output.qa?.warnings || []),
      ...(output.error ? [output.error] : []),
    ];
    const layout = output.layoutResult?.foregroundRect
      ? `${output.layoutResult.foregroundRect.width}x${output.layoutResult.foregroundRect.height} @ ${output.layoutResult.foregroundRect.x},${output.layoutResult.foregroundRect.y}`
      : '-';
    return `
      <tr>
        <td>${esc(output.assetName)}</td>
        <td>${esc(output.targetLabel)}</td>
        <td><span class="pill ${esc(qaStatus.toLowerCase())}">${esc(qaStatus)}</span></td>
        <td>${esc(output.decision)}</td>
        <td>${esc(output.command?.backgroundMode || '-')}</td>
        <td>${esc(layout)}</td>
        <td>${esc(output.outputName || '-')}</td>
        <td>${esc(notes.join(' | ') || 'OK')}</td>
      </tr>
    `;
  }).join('');

  const assetBlocks = job.assets.map(asset => {
    const info = asset.analysis;
    const video = info?.video;
    return `
      <section>
        <h2>${esc(asset.originalName)}</h2>
        <p>${video ? `${video.displayWidth}x${video.displayHeight}, ${Number(video.fps || 0).toFixed(2)} fps, ${esc(video.codec)}, ${formatBytes(info.sizeBytes)}` : esc(asset.error || 'No analysis')}</p>
      </section>
    `;
  }).join('');

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <title>QA Report ${esc(job.id)}</title>
  <style>
    body { font-family: Inter, Arial, sans-serif; color: #17202a; margin: 32px; background: #f7f8f8; }
    h1 { margin: 0 0 8px; font-size: 26px; }
    h2 { font-size: 16px; margin: 20px 0 6px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #d8dddf; }
    th, td { text-align: left; padding: 10px; border-bottom: 1px solid #e8ecee; vertical-align: top; font-size: 13px; }
    th { background: #eef2f3; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    .pill { display: inline-block; border-radius: 999px; padding: 2px 8px; font-weight: 700; font-size: 11px; }
    .pass { background: #d9f5e4; color: #106b36; }
    .warn { background: #fff0c2; color: #8a5a00; }
    .fail { background: #ffd9d9; color: #9b1c1c; }
    .pending { background: #e6e9ec; color: #59636b; }
  </style>
</head>
<body>
  <h1>Meta/TikTok Video QA Report</h1>
  <p>Job: ${esc(job.id)} | Status: ${esc(job.status)} | Created: ${esc(job.createdAt)}</p>
  ${assetBlocks}
  <h2>Outputs</h2>
  <table>
    <thead>
      <tr><th>Source</th><th>Target</th><th>QA</th><th>Decision</th><th>Background</th><th>Layout</th><th>File</th><th>Notes</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
