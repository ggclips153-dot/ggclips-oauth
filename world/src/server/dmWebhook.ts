// Nudges the District Messenger when Marc writes an intent. The webhook is only a doorbell:
// the ledger is the DM's queue, so a missed webhook loses nothing (the DM reads unrouted intents).
import { createHmac } from 'node:crypto';
import type { LedgerEvent } from '../domain/state.ts';
import type { Ledger } from '../ledger/ledger.ts';

export interface DmWebhookOptions {
  url: string;
  secret: string;
  retries?: number;
  log?: (msg: string) => void;
}

export function sign(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function attachDmWebhook(ledger: Ledger, opts: DmWebhookOptions): () => void {
  const log = opts.log ?? ((m) => console.warn(m));
  const retries = opts.retries ?? 3;

  const deliver = async (e: LedgerEvent) => {
    const body = JSON.stringify({ seq: e.seq, ts: e.ts, type: e.type, city: e.city, payload: e.payload });
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(opts.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-world-signature': sign(opts.secret, body) },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) return;
        log(`DM webhook for intent #${e.seq}: HTTP ${res.status}`);
      } catch (err) {
        log(`DM webhook for intent #${e.seq}: ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
    }
    log(`DM webhook for intent #${e.seq} gave up; DM will pick it up from the ledger`);
  };

  const onEvent = (e: LedgerEvent) => {
    if (e.kind === 'intent') void deliver(e);
  };
  ledger.events.on('event', onEvent);
  return () => ledger.events.off('event', onEvent);
}
