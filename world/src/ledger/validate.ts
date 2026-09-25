// Minimal strict payload validator. Unknown keys are rejected so nothing (secrets, stray
// "instruction" fields) rides along in an event unnoticed.
import { invalid } from './errors.ts';

export type Field =
  | { t: 'str'; min?: number; max?: number; opt?: boolean; oneOf?: readonly string[] }
  | { t: 'int'; min?: number; max?: number; opt?: boolean }
  | { t: 'num'; min?: number; opt?: boolean }
  | { t: 'date'; opt?: boolean }
  | { t: 'obj'; fields: Schema; opt?: boolean }
  | { t: 'json'; maxBytes: number; opt?: boolean };

export type Schema = Record<string, Field>;
export type Payload = Record<string, unknown>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Telegram bot tokens look like 123456789:AA... Tokens never go into the ledger, only a ref.
const TELEGRAM_TOKEN = /\d{6,}:[A-Za-z0-9_-]{30,}/;

export function validate(schema: Schema, value: unknown, path = 'payload'): Payload {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalid(`${path} must be an object`);
  }
  const input = value as Payload;
  for (const key of Object.keys(input)) {
    if (!(key in schema)) invalid(`${path}.${key} is not a known field`);
  }
  const out: Payload = {};
  for (const [key, field] of Object.entries(schema)) {
    const v = input[key];
    const p = `${path}.${key}`;
    if (v === undefined || v === null) {
      if (!field.opt) invalid(`${p} is required`);
      continue;
    }
    out[key] = checkField(field, v, p);
  }
  return out;
}

function checkField(field: Field, v: unknown, p: string): unknown {
  switch (field.t) {
    case 'str': {
      if (typeof v !== 'string') return invalid(`${p} must be a string`);
      const s = v.trim();
      if (s.length < (field.min ?? 1)) invalid(`${p} must not be empty`);
      if (s.length > (field.max ?? 200)) invalid(`${p} exceeds ${field.max ?? 200} characters`);
      if (field.oneOf && !field.oneOf.includes(s)) invalid(`${p} must be one of: ${field.oneOf.join(', ')}`);
      if (TELEGRAM_TOKEN.test(s)) invalid(`${p} looks like a bot token; store it as a secret and pass a ref`);
      return s;
    }
    case 'int':
      if (typeof v !== 'number' || !Number.isInteger(v)) return invalid(`${p} must be an integer`);
      if (field.min !== undefined && v < field.min) invalid(`${p} must be >= ${field.min}`);
      if (field.max !== undefined && v > field.max) invalid(`${p} must be <= ${field.max}`);
      return v;
    case 'num':
      if (typeof v !== 'number' || !Number.isFinite(v)) return invalid(`${p} must be a number`);
      if (field.min !== undefined && v < field.min) invalid(`${p} must be >= ${field.min}`);
      return v;
    case 'date':
      if (typeof v !== 'string' || !ISO_DATE.test(v) || Number.isNaN(Date.parse(v))) {
        return invalid(`${p} must be a YYYY-MM-DD date`);
      }
      return v;
    case 'obj':
      return validate(field.fields, v, p);
    case 'json': {
      const text = JSON.stringify(v);
      if (Buffer.byteLength(text) > field.maxBytes) invalid(`${p} exceeds ${field.maxBytes} bytes`);
      if (TELEGRAM_TOKEN.test(text)) invalid(`${p} contains what looks like a bot token`);
      return JSON.parse(text);
    }
  }
}
