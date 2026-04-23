/**
 * HTML template builder for red-flag analysis cards.
 * Template extracted from the redflag-analysis.skill file.
 */

import type { ConsensusBlock } from "./generate-analysis.js";

export interface Trigger {
  headline: string;
  body: string;
}

export interface AnalysisData {
  companyName: string;
  ticker: string;
  exchange: string;
  price: string;
  marketCap: string;
  reportPeriod: string;
  positive: [Trigger, Trigger, Trigger];
  negative: [Trigger, Trigger, Trigger];
  consensus: ConsensusBlock;
  consensusSourceUrl?: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderTrigger(trigger: Trigger): string {
  return `      <div class="rf-item">
        <div class="rf-item-head">${escapeHtml(trigger.headline)}</div>
        <div class="rf-item-body">${escapeHtml(trigger.body)}</div>
      </div>`;
}

function formatPctSigned(pct: number): string {
  const rounded = Math.round(pct * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  const dk = rounded.toFixed(1).replace(".", ",");
  return `${sign}${dk}%`;
}

function verdictClass(verdict: "beat" | "miss" | "inline"): string {
  if (verdict === "beat") return "rf-verdict-beat";
  if (verdict === "miss") return "rf-verdict-miss";
  return "rf-verdict-inline";
}

function renderConsensusSection(
  consensus: ConsensusBlock,
  sourceUrl?: string
): string {
  if (!consensus.includedInCard || consensus.rows.length === 0) return "";

  const rows = consensus.rows
    .map(
      (r) => `        <tr>
          <td>${escapeHtml(r.metric)}</td>
          <td>${escapeHtml(r.period)}</td>
          <td class="rf-num">${escapeHtml(r.konsensus)}</td>
          <td class="rf-num">${escapeHtml(r.faktisk)}</td>
          <td class="rf-num ${verdictClass(r.verdict)}">${escapeHtml(formatPctSigned(r.afvigelsePct))}</td>
        </tr>`
    )
    .join("\n");

  const sourceLine = sourceUrl
    ? `    <div class="rf-consensus-src">Kilde: <a href="${escapeHtml(sourceUrl)}">MarketScreener</a></div>`
    : "";

  return `
  <div class="rf-consensus">
    <div class="rf-bottom-label">Konsensus vs. realiseret:</div>
    <table class="rf-consensus-table">
      <thead>
        <tr><th>Metrik</th><th>Periode</th><th>Konsensus</th><th>Faktisk</th><th>Afvigelse</th></tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>
    <p class="rf-consensus-kommentar">${escapeHtml(consensus.kommentar)}</p>
${sourceLine}
  </div>`;
}

export function buildHtmlCard(data: AnalysisData): string {
  const positiveTriggers = data.positive.map(renderTrigger).join("\n\n");
  const negativeTriggers = data.negative.map(renderTrigger).join("\n\n");

  return `<h2 class="sr-only">${escapeHtml(data.companyName)} red flag aktieanalyse med positive og negative kurstriggere</h2>
<style>
  .rf-wrap { max-width: 780px; margin: 0 auto; font-family: var(--font-sans); padding: 1rem 0; }
  .rf-badge { display: inline-block; background: #4a6e5c; color: #fff; font-size: 10px; font-weight: 500; letter-spacing: 1px; text-transform: uppercase; padding: 4px 10px; border-radius: var(--border-radius-md) var(--border-radius-md) 0 0; }
  .rf-header { padding: 10px 0 14px; border-bottom: 1px solid var(--color-border-tertiary); margin-bottom: 16px; }
  .rf-header h1 { font-size: 18px; font-weight: 500; color: var(--color-text-primary); margin: 4px 0 2px; line-height: 1.3; }
  .rf-sub { font-size: 12px; color: var(--color-text-secondary); line-height: 1.4; }
  .rf-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 540px) { .rf-cols { grid-template-columns: 1fr; } }
  .rf-card { border-radius: var(--border-radius-lg); padding: 14px 16px; border: 0.5px solid; }
  .rf-card.pos { background: var(--color-background-success); border-color: var(--color-border-success); }
  .rf-card.neg { background: var(--color-background-danger); border-color: var(--color-border-danger); }
  .rf-card-title { font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 10px; }
  .rf-card.pos .rf-card-title { color: var(--color-text-success); }
  .rf-card.neg .rf-card-title { color: var(--color-text-danger); }
  .rf-item { margin-bottom: 10px; border-bottom: 0.5px solid var(--color-border-tertiary); padding-bottom: 10px; }
  .rf-item:last-child { margin-bottom: 0; border-bottom: none; padding-bottom: 0; }
  .rf-item-head { font-size: 13px; font-weight: 500; color: var(--color-text-primary); margin-bottom: 3px; line-height: 1.35; }
  .rf-item-body { font-size: 12px; color: var(--color-text-secondary); line-height: 1.5; }
  .rf-consensus { border-top: 1px solid var(--color-border-tertiary); margin-top: 18px; padding-top: 14px; }
  .rf-bottom-label { font-size: 12px; font-weight: 500; color: var(--color-text-primary); margin-bottom: 8px; }
  .rf-consensus-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 10px; }
  .rf-consensus-table th { text-align: left; font-weight: 500; color: var(--color-text-secondary); border-bottom: 1px solid var(--color-border-tertiary); padding: 4px 6px; }
  .rf-consensus-table td { padding: 4px 6px; color: var(--color-text-primary); border-bottom: 1px solid var(--color-border-tertiary); }
  .rf-consensus-table td.rf-num { text-align: right; font-variant-numeric: tabular-nums; }
  .rf-verdict-beat { color: #3d7a56; font-weight: 500; }
  .rf-verdict-miss { color: #a03030; font-weight: 500; }
  .rf-verdict-inline { color: var(--color-text-secondary); }
  .rf-consensus-kommentar { font-size: 12px; color: var(--color-text-secondary); line-height: 1.6; margin-top: 6px; }
  .rf-consensus-src { font-size: 10px; color: var(--color-text-tertiary); margin-top: 6px; }
  .rf-consensus-src a { color: inherit; }
  .rf-disc { border-top: 1px solid var(--color-border-tertiary); margin-top: 14px; padding-top: 10px; }
  .rf-disc p { font-size: 10px; color: var(--color-text-tertiary); line-height: 1.5; font-style: italic; }
  @media (prefers-color-scheme: dark) {
    .rf-badge { background: #3d5c4c; }
    .rf-verdict-beat { color: #5dc98a; }
    .rf-verdict-miss { color: #e06060; }
  }
</style>
<div class="rf-wrap">
  <div class="rf-badge">&#9889; AI-genereret analyse</div>
  <div class="rf-header">
    <h1>${escapeHtml(data.companyName)} &#8212; Redflag aktieanalyse</h1>
    <div class="rf-sub">Ticker: ${escapeHtml(data.ticker)} &#183; ${escapeHtml(data.exchange)} &#183; Kurs: DKK ${escapeHtml(data.price)} &#183; Markedsv&aelig;rdi: ${escapeHtml(data.marketCap)} &#183; ${escapeHtml(data.reportPeriod)}</div>
  </div>

  <div class="rf-cols">
    <div class="rf-card pos">
      <div class="rf-card-title">&#10003; Positive kurstriggere</div>

${positiveTriggers}
    </div>

    <div class="rf-card neg">
      <div class="rf-card-title">&#10005; Negative kurstriggere / redflag</div>

${negativeTriggers}
    </div>
  </div>

${renderConsensusSection(data.consensus, data.consensusSourceUrl)}

  <div class="rf-disc">
    <p>&#9888; Disclaimer: Dette er en HCA AI-genereret research-kommentar baseret udelukkende p&aring; selskabets offentliggjorte regnskab. Kommentaren udg&oslash;r ikke investeringsr&aring;dgivning og b&oslash;r ikke alene l&aelig;gges til grund for investeringsbeslutninger. Investering i aktier indeb&aelig;rer risiko for tab. S&oslash;g professionel r&aring;dgivning.</p>
  </div>
</div>`;
}

/**
 * Build plain-text content for Meta Business Suite post.
 */
export function buildTextContent(data: AnalysisData): string {
  const lines: string[] = [];

  lines.push(`${data.companyName} — Redflag aktieanalyse #aktier #dkfinans #redflag`);
  lines.push("");

  lines.push("Positive kurstriggere:");
  data.positive.forEach((t, i) => {
    lines.push(`${i + 1}. ${t.headline}`);
    lines.push(`   ${t.body}`);
    lines.push("");
  });

  lines.push("Negative kurstriggere / redflag:");
  data.negative.forEach((t, i) => {
    lines.push(`${i + 1}. ${t.headline}`);
    lines.push(`   ${t.body}`);
    lines.push("");
  });

  if (data.consensus.includedInCard && data.consensus.rows.length > 0) {
    lines.push("Konsensus vs. realiseret:");
    data.consensus.rows.forEach((r) => {
      lines.push(
        `- ${r.metric} (${r.period}): konsensus ${r.konsensus} | faktisk ${r.faktisk} | ${formatPctSigned(r.afvigelsePct)} (${r.verdict})`
      );
    });
    lines.push("");
    lines.push(data.consensus.kommentar);
    if (data.consensusSourceUrl) {
      lines.push(`Kilde: MarketScreener (${data.consensusSourceUrl})`);
    }
    lines.push("");
  }

  lines.push(
    "Disclaimer: Dette er en HCA AI-genereret research-kommentar baseret udelukkende på selskabets offentliggjorte regnskab. Kommentaren udgør ikke investeringsrådgivning og bør ikke alene lægges til grund for investeringsbeslutninger. Investering i aktier indebærer risiko for tab. Søg professionel rådgivning."
  );

  return lines.join("\n");
}
