import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A pretend Paystack for the payment tests (issue: payments end-to-end tests). It runs as a real HTTP server on this
 * machine and answers with Paystack's documented response shapes, so the backend's own Paystack client is exercised for real.
 * Nothing here ever reaches the internet. It records every call, and faults can be switched on per test.
 */
export interface FakeCall {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

export type Fault =
  | { kind: "timeout" }
  /** Paystack does the work but the answer never reaches us (the unknown-outcome case) */
  | { kind: "lost_response" }
  | { kind: "status"; status: number; message?: string }
  | { kind: "insufficient_balance" };

interface Tx {
  reference: string;
  amount: number;
  currency: string;
  email: string;
  metadata: Record<string, unknown>;
  status: "initialized" | "success" | "failed" | "abandoned";
  id: number;
  channel: string;
  paid_at: string | null;
  /** what verify reports instead of the true amount / currency (to test a mismatch) */
  reportAmount?: number;
  reportCurrency?: string;
}

export interface FakePaystack {
  url: string;
  secret: string;
  calls: FakeCall[];
  callsTo(method: string, path: RegExp | string): FakeCall[];
  /** make the next calls to a path fail (until cleared) */
  fault(path: RegExp, fault: Fault | null): void;
  /** the buyer paid on Paystack's hosted page */
  completeCheckout(reference: string, opts?: { channel?: string; reportAmount?: number; reportCurrency?: string }): Record<string, unknown>;
  declineCheckout(reference: string, status?: "failed" | "abandoned"): void;
  /** what Paystack's `data` looks like for a transaction (used in charge.success) */
  txData(reference: string): Record<string, unknown>;
  /** how a transfer ends on Paystack's side */
  setTransferOutcome(reference: string, status: "success" | "failed" | "reversed" | "pending"): void;
  transfers: Map<string, { status: string; amount: number; recipient: string; code: string }>;
  refunds: Array<{ transaction: string; amount?: number; id: number }>;
  txs: Map<string, Tx>;
  close(): Promise<void>;
  reset(): void;
  /** the signature Paystack puts on a webhook body */
  sign(raw: string): string;
}

const ok = (data: unknown, message = "OK") => JSON.stringify({ status: true, message, data });

export async function startFakePaystack(secret = "sk_test_fake_paystack_secret"): Promise<FakePaystack> {
  const state = {
    calls: [] as FakeCall[],
    faults: [] as Array<{ path: RegExp; fault: Fault }>,
    txs: new Map<string, Tx>(),
    transfers: new Map<string, { status: string; amount: number; recipient: string; code: string }>(),
    refunds: [] as Array<{ transaction: string; amount?: number; id: number }>,
    seq: 1000,
  };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const path = (req.url ?? "").replace(/\?.*$/, "");
      const method = req.method ?? "GET";
      let body: Record<string, unknown> | null = null;
      try {
        body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>) : null;
      } catch {
        body = null;
      }
      state.calls.push({ method, path, body });
      const lost = state.faults.some((f) => f.path.test(path) && f.fault.kind === "lost_response");
      const send = (status: number, payload: string) => {
        if (lost) return; // handled, but nobody hears back
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(payload);
      };

      if (req.headers.authorization !== `Bearer ${secret}`) return send(401, JSON.stringify({ status: false, message: "Invalid key" }));

      const injected = state.faults.find((f) => f.path.test(path));
      if (injected) {
        const f = injected.fault;
        if (f.kind === "lost_response") {
          /* fall through to the normal handler below, which records the work but does not answer */
        } else if (f.kind === "timeout") return; // never answer: the caller's own timeout ends it
        else if (f.kind === "status") return send(f.status, JSON.stringify({ status: false, message: f.message ?? "Paystack error" }));
        else if (f.kind === "insufficient_balance") return send(400, JSON.stringify({ status: false, message: "Your balance is not enough to fulfil this request" }));
      }

      // ---- transactions
      if (method === "POST" && path === "/transaction/initialize") {
        const reference = String(body?.reference ?? `ref_${++state.seq}`);
        if (state.txs.has(reference)) return send(400, JSON.stringify({ status: false, message: "Duplicate Transaction Reference" }));
        state.txs.set(reference, {
          reference,
          amount: Number(body?.amount),
          currency: "NGN",
          email: String(body?.email ?? ""),
          metadata: (body?.metadata as Record<string, unknown>) ?? {},
          status: "initialized",
          id: ++state.seq,
          channel: "card",
          paid_at: null,
        });
        return send(200, ok({ authorization_url: `https://checkout.paystack.test/${reference}`, access_code: `AC_${reference}`, reference }, "Authorization URL created"));
      }
      const verify = /^\/transaction\/verify\/(.+)$/.exec(path);
      if (method === "GET" && verify) {
        const t = state.txs.get(decodeURIComponent(verify[1]!));
        if (!t) return send(404, JSON.stringify({ status: false, message: "Transaction reference not found" }));
        return send(200, ok(txData(t), "Verification successful"));
      }
      if (method === "GET" && path === "/transaction") {
        const rows = [...state.txs.values()].filter((t) => t.status === "success").map(txData);
        return send(200, ok(rows));
      }

      // ---- refunds
      if (method === "POST" && path === "/refund") {
        const tx = state.txs.get(String(body?.transaction));
        if (!tx || tx.status !== "success") return send(400, JSON.stringify({ status: false, message: "Transaction not found or not successful" }));
        const refund = { transaction: tx.reference, amount: body?.amount == null ? undefined : Number(body.amount), id: ++state.seq };
        state.refunds.push(refund);
        return send(200, ok({ transaction: { reference: tx.reference }, amount: refund.amount ?? tx.amount, status: "pending", id: refund.id }, "Refund has been queued for processing"));
      }

      // ---- banks and transfers
      if (method === "GET" && path === "/bank") return send(200, ok([{ name: "Zenith Bank", code: "057" }, { name: "Test Bank", code: "001" }]));
      if (method === "GET" && path === "/bank/resolve") return send(200, ok({ account_name: "ADA OBI", account_number: "0123456789" }));
      if (method === "POST" && path === "/transferrecipient") return send(200, ok({ recipient_code: `RCP_${++state.seq}`, active: true, details: { account_number: "0123456789" } }, "Recipient created"));
      if (method === "POST" && path === "/transfer") {
        const reference = String(body?.reference ?? "");
        if (state.transfers.has(reference)) return send(400, JSON.stringify({ status: false, message: "Transfer with this reference already exists" }));
        const t = { status: "pending", amount: Number(body?.amount), recipient: String(body?.recipient), code: `TRF_${++state.seq}` };
        state.transfers.set(reference, t);
        return send(200, ok({ reference, transfer_code: t.code, status: t.status, amount: t.amount }, "Transfer has been queued"));
      }
      const tv = /^\/transfer\/verify\/(.+)$/.exec(path);
      if (method === "GET" && tv) {
        const reference = decodeURIComponent(tv[1]!);
        const t = state.transfers.get(reference);
        if (!t) return send(404, JSON.stringify({ status: false, message: "Transfer not found" }));
        return send(200, ok({ reference, status: t.status, transfer_code: t.code, amount: t.amount }));
      }
      return send(404, JSON.stringify({ status: false, message: `Not found: ${method} ${path}` }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  function txData(t: Tx): Record<string, unknown> {
    return {
      id: t.id,
      reference: t.reference,
      status: t.status,
      amount: t.reportAmount ?? t.amount,
      currency: t.reportCurrency ?? t.currency,
      channel: t.channel,
      paid_at: t.paid_at,
      metadata: t.metadata,
      customer: { email: t.email, customer_code: "CUS_test" },
      authorization: { authorization_code: "AUTH_test" },
    };
  }

  const api: FakePaystack = {
    url,
    secret,
    calls: state.calls,
    callsTo: (method, path) => state.calls.filter((c) => c.method === method && (typeof path === "string" ? c.path === path : path.test(c.path))),
    fault: (path, fault) => {
      state.faults = state.faults.filter((f) => f.path.source !== path.source);
      if (fault) state.faults.push({ path, fault });
    },
    completeCheckout: (reference, opts = {}) => {
      const t = state.txs.get(reference);
      if (!t) throw new Error(`No such transaction: ${reference}`);
      t.status = "success";
      t.channel = opts.channel ?? "card";
      t.paid_at = new Date().toISOString();
      if (opts.reportAmount != null) t.reportAmount = opts.reportAmount;
      if (opts.reportCurrency) t.reportCurrency = opts.reportCurrency;
      return txData(t);
    },
    declineCheckout: (reference, status = "failed") => {
      const t = state.txs.get(reference);
      if (t) t.status = status;
    },
    txData: (reference) => {
      const t = state.txs.get(reference);
      if (!t) throw new Error(`No such transaction: ${reference}`);
      return txData(t);
    },
    setTransferOutcome: (reference, status) => {
      const t = state.transfers.get(reference);
      if (t) t.status = status;
    },
    transfers: state.transfers,
    refunds: state.refunds,
    txs: state.txs,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    reset: () => {
      state.calls.length = 0;
      state.faults = [];
      state.txs.clear();
      state.transfers.clear();
      state.refunds.length = 0;
    },
    sign: (raw) => crypto.createHmac("sha512", secret).update(raw).digest("hex"),
  };
  return api;
}
