import { nairaToKobo } from "./money.js";
import { PaystackRejected, PaystackUnavailable, PaystackUnknownOutcome } from "./errors.js";

/**
 * The one place the backend talks to Paystack (https://paystack.com/docs/api/). Money comes in as kobo here;
 * convert naira with nairaToKobo() at the call site. Nothing in this file logs.
 */
export interface PaystackClientOptions {
  secretKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface PaystackEnvelope<T = Record<string, unknown>> {
  status?: boolean;
  message?: string;
  data?: T;
  meta?: Record<string, unknown>;
}

type Json = Record<string, unknown>;

export class PaystackClient {
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly customFetch: typeof fetch | undefined;

  constructor(options: PaystackClientOptions) {
    this.secretKey = options.secretKey;
    this.baseUrl = (options.baseUrl ?? "https://api.paystack.co").replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.customFetch = options.fetch;
  }

  /**
   * Low-level call that returns Paystack's answer untouched, the way the original functions used it
   * (`res.ok && json.status`). No timeout unless one is passed, so existing behaviour does not change.
   */
  async rawRequest<T = Json>(path: string, init: RequestInit = {}, parse: "strict" | "lenient" = "strict", timeoutMs?: number) {
    const controller = timeoutMs ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      // the global fetch is looked up on every call, so a replaced fetch (tests, polyfills) is honoured
      const res = await (this.customFetch ?? fetch)(`${this.baseUrl}${path}`, {
        ...init,
        ...(controller ? { signal: controller.signal } : {}),
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers as Record<string, string> | undefined),
        },
      });
      const json = (parse === "strict" ? await res.json() : await res.json().catch(() => ({}))) as PaystackEnvelope<T>;
      return { res, json };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Typed call: returns `data`, or throws PaystackUnknownOutcome / PaystackRejected / PaystackUnavailable. */
  private async request<T>(method: "GET" | "POST", path: string, body?: Json): Promise<T> {
    let result: { res: Response; json: PaystackEnvelope<T> };
    try {
      result = await this.rawRequest<T>(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) }, "lenient", this.timeoutMs);
    } catch {
      // timeout or network error: the outcome is unknown
      throw new PaystackUnknownOutcome();
    }
    const { res, json } = result;
    if (res.status >= 500) throw new PaystackUnavailable(undefined, res.status);
    if (!res.ok || json.status === false) throw new PaystackRejected(json.message || "Paystack refused the request.", res.status);
    return json.data as T;
  }

  initializeTransaction(input: {
    email: string;
    amountKobo: number;
    reference: string;
    callbackUrl?: string;
    metadata?: Json;
    channels?: string[];
    subaccount?: string;
  }) {
    return this.request<{ authorization_url: string; access_code: string; reference: string }>("POST", "/transaction/initialize", {
      email: input.email,
      amount: input.amountKobo,
      reference: input.reference,
      ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(input.channels ? { channels: input.channels } : {}),
      ...(input.subaccount ? { subaccount: input.subaccount } : {}),
    });
  }

  verifyTransaction(reference: string) {
    return this.request<PaystackTransactionData>("GET", `/transaction/verify/${encodeURIComponent(reference)}`);
  }

  fetchTransaction(id: number | string) {
    return this.request<PaystackTransactionData>("GET", `/transaction/${encodeURIComponent(String(id))}`);
  }

  listTransactions(query: { from?: string; to?: string; status?: string; page?: number; perPage?: number } = {}) {
    const q = new URLSearchParams();
    if (query.from) q.set("from", query.from);
    if (query.to) q.set("to", query.to);
    if (query.status) q.set("status", query.status);
    if (query.page) q.set("page", String(query.page));
    if (query.perPage) q.set("perPage", String(query.perPage));
    const qs = q.toString();
    return this.request<PaystackTransactionData[]>("GET", `/transaction${qs ? `?${qs}` : ""}`);
  }

  createRefund(input: { transaction: string; amountKobo?: number }) {
    return this.request<Json>("POST", "/refund", {
      transaction: input.transaction,
      ...(input.amountKobo != null ? { amount: input.amountKobo } : {}),
    });
  }

  listBanks() {
    return this.request<{ name: string; code: string; slug?: string }[]>("GET", "/bank?country=nigeria&currency=NGN&perPage=100");
  }

  resolveAccount(input: { accountNumber: string; bankCode: string }) {
    const q = new URLSearchParams({ account_number: input.accountNumber, bank_code: input.bankCode });
    return this.request<{ account_name: string; account_number: string }>("GET", `/bank/resolve?${q.toString()}`);
  }

  createTransferRecipient(input: { name: string; accountNumber: string; bankCode: string }) {
    return this.request<{ recipient_code: string }>("POST", "/transferrecipient", {
      type: "nuban",
      name: input.name,
      account_number: input.accountNumber,
      bank_code: input.bankCode,
      currency: "NGN",
    });
  }

  initiateTransfer(input: { amountKobo: number; recipientCode: string; reference: string; reason?: string }) {
    return this.request<{ transfer_code: string; reference: string; status: string }>("POST", "/transfer", {
      source: "balance",
      amount: input.amountKobo,
      recipient: input.recipientCode,
      reference: input.reference,
      ...(input.reason ? { reason: input.reason } : {}),
    });
  }

  verifyTransfer(reference: string) {
    return this.request<{ status: string; reference: string; transfer_code?: string; amount?: number }>(
      "GET",
      `/transfer/verify/${encodeURIComponent(reference)}`,
    );
  }
}

export interface PaystackTransactionData {
  id?: number;
  status?: string;
  reference?: string;
  amount?: number;
  currency?: string;
  channel?: string;
  paid_at?: string;
  metadata?: Json | null;
  authorization?: { authorization_code?: string } | null;
  customer?: { customer_code?: string; email?: string } | null;
  [key: string]: unknown;
}

export { nairaToKobo };
