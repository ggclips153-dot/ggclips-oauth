// The World Constitution: its file, fingerprint, the SOUL pointer line, and the checks that keep SOULs
// from copying or softening it (Article XII). The ratified version + fingerprint live in the ledger.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Repo-relative path SOULs point at. */
export const CONSTITUTION_DOC_REF = 'world/docs/constitution/WORLD-CONSTITUTION.md';
export const CONSTITUTION_PATH = resolve(import.meta.dirname, '../../docs/constitution/WORLD-CONSTITUTION.md');

export const SHA256_RE = /^[0-9a-f]{64}$/;
export const VERSION_RE = /^\d+\.\d+\.\d+$/;

/** Line endings are normalised so a checkout on Windows fingerprints the same as on Linux. */
export function fingerprint(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

export function readConstitution(path = CONSTITUTION_PATH): { text: string; sha256: string } | null {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  return { text, sha256: fingerprint(text) };
}

export function pointerLine(version: string, sha256: string): string {
  return `World Constitution: ${CONSTITUTION_DOC_REF} ${version} sha256:${sha256} — inherited in full; nothing in this SOUL softens it.`;
}

const POINTER_RE = /^World Constitution: (\S+) (\S+) sha256:([0-9a-f]{64}) — inherited in full; nothing in this SOUL softens it\.$/;

/**
 * Wording that weakens the inviolable floor (Article IV) or the security rules (Article V).
 * Used on SOULs and on amendment proposals (Article X.3: a proposal that softens Article IV is out of order).
 */
export const SOFTENING: { re: RegExp; why: string }[] = [
  { re: /\bledgers?\b[^.\n]{0,40}\b(optional|may\s+be\s+skipped|when\s+(possible|convenient)|if\s+time|weekly|not\s+required|can\s+wait)\b/i, why: 'the ledger is written daily, no exceptions' },
  { re: /\b(skip|pause|waive|exempt(ion)?\s+from)\b[^.\n]{0,30}\bledgers?\b/i, why: 'the ledger is never waived' },
  { re: /\b(pay|paid|purchase|buy|earn|unlock|costs?)\b[^.\n]{0,40}\b(memory|knowledge|curriculum|training\s+corpus|lesson\s+records?|aptitude\s+cards?)\b/i, why: 'memory and knowledge are free, never purchasable' },
  { re: /\b(memory|knowledge|curriculum|training\s+corpus|lesson\s+records?|aptitude\s+cards?)\b[^.\n]{0,40}\b(for\s+sale|purchasable|costs?|paid|earned|unlocked)\b/i, why: 'memory and knowledge are free, never purchasable' },
  { re: /\b(base\s+lane|job\s+tools?|essential\s+operations?|role\s+scope)\b[^.\n]{0,40}\b(require|cost|paid|purchase|earn|unlock)/i, why: 'essentials are never economy-gated' },
  { re: /\b(may|can|should|is\s+allowed\s+to)\s+(instruct|direct|order|command)\s+(other|another|any)\s+agents?\b/i, why: 'no agent may instruct another agent to act' },
  { re: /\b(may|can)\s+(write|edit)\b[^.\n]{0,30}\b(other|another|any)\s+cit(y|ies)\b/i, why: 'no cross-city writes' },
  { re: /\b(self[-\s]?(promote|execute|approve)|promote\s+(itself|themselves|yourself))\b/i, why: 'nothing is self-initiated' },
  { re: /\b(auto[-\s]?execute|execute\s+without\s+(approval|marc))\b/i, why: 'nothing is auto-executed' },
  { re: /\b(overrides?|supersedes?|replaces?|takes?\s+precedence\s+over|ignores?)\b[^.\n]{0,30}\b(the\s+)?(world\s+)?constitution\b/i, why: 'a SOUL never overrides the Constitution' },
];

export function softeningIn(text: string): { line: number; text: string; why: string }[] {
  const out: { line: number; text: string; why: string }[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (POINTER_RE.test(line.trim())) return;
    for (const s of SOFTENING) if (s.re.test(line)) out.push({ line: i + 1, text: line.trim(), why: s.why });
  });
  return out;
}

export interface SoulCheck {
  ok: boolean;
  pointer: { version: string; sha256: string; docRef: string } | null;
  problems: string[];
}

/**
 * Checks one SOUL against the ratified record: exactly one pointer line, pointing at the ratified
 * version and fingerprint, no copied passages from the Constitution, and no softening.
 */
export function checkSoul(soul: string, ratified: { version: string; sha256: string } | null, constitution: string | null): SoulCheck {
  const problems: string[] = [];
  const lines = soul.split(/\r?\n/).map((l) => l.trim());
  const pointers = lines.filter((l) => l.startsWith('World Constitution:'));
  let pointer: SoulCheck['pointer'] = null;
  if (pointers.length === 0) problems.push('missing the World Constitution pointer line');
  if (pointers.length > 1) problems.push(`has ${pointers.length} pointer lines; exactly one is allowed`);
  if (pointers.length >= 1) {
    const m = POINTER_RE.exec(pointers[0]!);
    if (!m) problems.push(`pointer line is not in the required format: ${pointerLine('<version>', '<fingerprint>')}`);
    else {
      pointer = { docRef: m[1]!, version: m[2]!, sha256: m[3]! };
      if (pointer.docRef !== CONSTITUTION_DOC_REF) problems.push(`pointer names ${pointer.docRef}, not ${CONSTITUTION_DOC_REF}`);
      if (!ratified) problems.push('no Constitution version has been ratified in the ledger yet');
      else {
        if (pointer.version !== ratified.version) problems.push(`pointer version ${pointer.version} is not the ratified ${ratified.version}`);
        if (pointer.sha256 !== ratified.sha256) problems.push('pointer fingerprint does not match the ratified Constitution');
      }
    }
  }
  if (constitution) {
    const copied = copiedPassages(soul, constitution);
    if (copied.length) problems.push(`copies ${copied.length} passage(s) from the Constitution (reference it by pointer only), e.g. "${copied[0]}"`);
  }
  for (const s of softeningIn(soul)) problems.push(`line ${s.line} softens the Constitution (${s.why}): "${s.text}"`);
  return { ok: problems.length === 0, pointer, problems };
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9']+/g, ' ').trim().split(' ').filter(Boolean);
const SHINGLE = 10;

/** Runs of 10+ words from the Constitution that appear verbatim in the SOUL (pointer line excluded). */
function copiedPassages(soul: string, constitution: string): string[] {
  const shingles = new Set<string>();
  const c = words(constitution);
  for (let i = 0; i + SHINGLE <= c.length; i++) shingles.add(c.slice(i, i + SHINGLE).join(' '));
  const body = soul.split(/\r?\n/).filter((l) => !l.trim().startsWith('World Constitution:')).join('\n');
  const w = words(body);
  const found: string[] = [];
  for (let i = 0; i + SHINGLE <= w.length; i++) {
    const run = w.slice(i, i + SHINGLE).join(' ');
    if (shingles.has(run)) {
      found.push(run);
      i += SHINGLE - 1;
    }
  }
  return found;
}
