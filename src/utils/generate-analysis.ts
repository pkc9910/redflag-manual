/**
 * Generate red-flag analysis content via the Claude Code CLI in headless
 * mode (`claude -p`). The call is billed against the signed-in Claude Code
 * subscription, so no ANTHROPIC_API_KEY is required.
 *
 * The CLI is resolved in this order:
 *   1. $CLAUDE_CLI_PATH (explicit override)
 *   2. %USERPROFILE%\.local\bin\claude.exe  (Windows default install)
 *   3. "claude" on PATH
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { Trigger } from "./html-template.js";
import type { ConsensusData } from "./fetch-consensus-estimates.js";

export interface ConsensusRow {
  metric: string;
  period: string;
  konsensus: string;
  faktisk: string;
  afvigelsePct: number;
  verdict: "beat" | "miss" | "inline";
}

export interface ConsensusBlock {
  includedInCard: boolean;
  rows: ConsensusRow[];
  kommentar: string;
}

export interface AnalysisResult {
  positive: [Trigger, Trigger, Trigger];
  negative: [Trigger, Trigger, Trigger];
  consensus: ConsensusBlock;
}

const SYSTEM_PROMPT = `You are a Danish financial analyst specializing in Nordic equities. You produce structured red-flag analyses for Nasdaq Copenhagen companies.

Your output MUST be valid JSON matching this exact schema — no markdown, no commentary, no wrapping:
{
  "positive": [
    { "headline": "...", "body": "..." },
    { "headline": "...", "body": "..." },
    { "headline": "...", "body": "..." }
  ],
  "negative": [
    { "headline": "...", "body": "..." },
    { "headline": "...", "body": "..." },
    { "headline": "...", "body": "..." }
  ],
  "consensus": {
    "includedInCard": true,
    "rows": [
      { "metric": "Omsætning", "period": "FY2025", "konsensus": "DKK 12.500 mio.", "faktisk": "DKK 12.890 mio.", "afvigelsePct": 3.1, "verdict": "beat" }
    ],
    "kommentar": "..."
  }
}

CONTENT RULES — follow these exactly:

LANGUAGE: Danish. Use professional financial terms: EBITDA, EBIT, DKK, mio., mia., Q1-Q4, H1/H2.

POSITIVE KURSTRIGGERE (exactly 3):
- Each headline: max 8 words, scannable
- Each body: 2-4 sentences, 40-60 words, must cite specific DKK figures
- Prioritize: guidance credibility (first if management delivered), new products/markets, order pipeline, margin trajectory, upcoming catalysts
- If management delivered on prior guidance, this MUST be the first positive trigger

NEGATIVE KURSTRIGGERE / RED FLAGS (exactly 3):
- Same format as positive
- Prioritize: going concern (MUST be first if auditor flagged it), guidance misses, customer/supplier concentration, litigation/warranty exposure, revenue lumpiness, management turnover
- If auditor flagged going concern, this MUST be the first negative trigger

KONSENSUS vs. REALISERET:
- This section applies to ANNUAL reports only. The caller only passes a CONSENSUS ESTIMATES block for full-year releases — quarterly/interim reports never receive consensus data because free sources publish FY consensus only.
- If a "CONSENSUS ESTIMATES" block is provided, set "includedInCard": true and produce 1–4 rows.
- If no consensus block is provided (or it's empty), set "includedInCard": false, "rows": [], "kommentar": "" — do NOT invent figures, do NOT synthesise pacing comparisons.
- ALWAYS include Omsætning/Revenue as a row when consensus for it exists.
- Then include 1–3 additional metrics that match what the company itself guides on, OR are the most material metric for this company's business model (EBITDA for industrials, EBIT/ROE for banks, EPS for capital-light businesses, etc.). Skip metrics where you cannot find the actual reported figure with confidence.
- For each row:
    - "metric": Danish label — "Omsætning", "EBITDA", "EBIT", "Nettoresultat", or "EPS"
    - "period": the consensus fiscal period as given (e.g. "FY2025")
    - "konsensus" and "faktisk": formatted Danish strings, e.g. "DKK 12.500 mio." or "DKK 4,25"
    - "afvigelsePct": signed percent, faktisk vs konsensus, one decimal
    - "verdict": "beat" if afvigelsePct > +3, "miss" if < −3, otherwise "inline"
- "kommentar" (3–5 sentences, Danish): summarize the overall beat/miss pattern, explain WHY it matters, and state the near-term share-price implication directly. Be specific — name the metrics, the magnitude, and what re-rates the stock from here. No hedging.

QUALITY REQUIREMENTS:
- Every trigger and consensus row must name specific DKK amounts, percentages, or dates.
- Never invent or extrapolate consensus figures. If consensus is not provided for a metric, omit the row.
- If a trigger could apply to any company without changes, it is too vague — rewrite it
- No buy/sell recommendations
- Compare management's prior guidance to actual delivery — this is the most important signal`;

function serialiseConsensus(consensus: ConsensusData | null): string {
  if (!consensus || consensus.metrics.length === 0) {
    return "CONSENSUS ESTIMATES:\nNone available — set consensus.includedInCard=false, rows=[], kommentar=\"\".";
  }
  const lines = [
    `CONSENSUS ESTIMATES (source: ${consensus.source}, retrieved ${consensus.retrievedAt}):`,
  ];
  for (const m of consensus.metrics) {
    const count = m.analystCount ? ` [n=${m.analystCount}]` : "";
    lines.push(`- ${m.metric} ${m.period}: ${m.value} ${m.unit}${count}`);
  }
  return lines.join("\n");
}

function buildUserPrompt(
  companyName: string,
  ticker: string,
  reportPeriod: string,
  earningsText: string,
  consensus: ConsensusData | null
): string {
  return `Analyze the following earnings data for ${companyName} (${ticker}) and produce a red-flag analysis for the ${reportPeriod}.

EARNINGS DATA:
${earningsText}

${serialiseConsensus(consensus)}

Respond with ONLY the JSON object — no markdown fences, no explanation.`;
}

function resolveClaudeCli(): string {
  if (process.env.CLAUDE_CLI_PATH) return process.env.CLAUDE_CLI_PATH;
  if (platform() === "win32") {
    const winPath = join(homedir(), ".local", "bin", "claude.exe");
    if (existsSync(winPath)) return winPath;
  }
  return "claude";
}

function extractJsonObject(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) return raw.slice(first, last + 1);
  return raw.trim();
}

async function runClaudeCli(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const cli = resolveClaudeCli();
  const model = process.env.CLAUDE_CLI_MODEL ?? "sonnet";
  const args = [
    "-p",
    "--system-prompt", systemPrompt,
    "--model", model,
    "--tools", "",
    "--output-format", "text",
    "--no-session-persistence",
    "--permission-mode", "bypassPermissions",
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(cli, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    proc.on("error", (err) => reject(
      new Error(`Failed to spawn claude CLI at "${cli}": ${err.message}`)
    ));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(
          `claude CLI exited ${code}.\nstderr: ${stderr.trim()}\nstdout: ${stdout.trim().slice(0, 500)}`
        ));
      } else {
        resolve(stdout);
      }
    });
    proc.stdin.write(userPrompt);
    proc.stdin.end();
  });
}

export async function generateAnalysis(
  companyName: string,
  ticker: string,
  reportPeriod: string,
  earningsText: string,
  consensus: ConsensusData | null
): Promise<AnalysisResult> {
  const userPrompt = buildUserPrompt(
    companyName,
    ticker,
    reportPeriod,
    earningsText,
    consensus
  );

  const raw = await runClaudeCli(SYSTEM_PROMPT, userPrompt);
  const jsonText = extractJsonObject(raw);

  let parsed: AnalysisResult;
  try {
    parsed = JSON.parse(jsonText) as AnalysisResult;
  } catch (err) {
    throw new Error(
      `claude CLI returned non-JSON output: ${err instanceof Error ? err.message : String(err)}\nraw: ${raw.slice(0, 1000)}`
    );
  }

  if (parsed.positive?.length !== 3) {
    throw new Error(`Expected 3 positive triggers, got ${parsed.positive?.length}`);
  }
  if (parsed.negative?.length !== 3) {
    throw new Error(`Expected 3 negative triggers, got ${parsed.negative?.length}`);
  }
  if (!parsed.consensus || typeof parsed.consensus.includedInCard !== "boolean") {
    throw new Error("Consensus block is missing or malformed");
  }
  if (parsed.consensus.includedInCard) {
    if (!Array.isArray(parsed.consensus.rows) || parsed.consensus.rows.length === 0) {
      throw new Error("Consensus marked includedInCard=true but rows is empty");
    }
    if (!parsed.consensus.kommentar || parsed.consensus.kommentar.length < 50) {
      throw new Error("Consensus kommentar is missing or too short");
    }
  }

  return parsed;
}
