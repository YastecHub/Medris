/** Paystack failures, in three kinds the caller must treat differently. */

/** The request may or may not have reached Paystack (timeout, dropped connection). Look the thing up; never retry blindly. */
export class PaystackUnknownOutcome extends Error {
  constructor(message = "Paystack did not answer in time. Check the result before trying again.") {
    super(message);
    this.name = "PaystackUnknownOutcome";
  }
}

/** Paystack understood the request and said no (4xx). `message` is Paystack's own text. */
export class PaystackRejected extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "PaystackRejected";
  }
}

/** Paystack had a problem on its side (5xx). Safe to look up and try again later. */
export class PaystackUnavailable extends Error {
  constructor(message = "Paystack is not available right now.", readonly status?: number) {
    super(message);
    this.name = "PaystackUnavailable";
  }
}

/** Last four digits only, for any message or log line that mentions a bank account. */
export function maskAccount(accountNumber: string): string {
  const digits = String(accountNumber).replace(/\D/g, "");
  return digits.length > 4 ? `******${digits.slice(-4)}` : "****";
}
