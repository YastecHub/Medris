/**
 * Request/response contracts of the public API, shared with medris-frontend
 * (imported there as `@medris/contracts`, type-only). They describe what the
 * endpoints accept and return today; keep them in step with the route code.
 */

export interface ApiError {
  error: string;
}

/* ------------------------------------------------------------- accounts */

export interface RegisterRequest {
  action: "register";
  name: string;
  phone: string;
  password: string;
  role: "buyer" | "vendor";
  email?: string;
  city?: string;
  referral_code?: string;
}
export interface RegisterResponse {
  created: true;
  userId: string;
  loginEmail: string;
  referral: unknown;
}

export interface AccountExistsRequest {
  action: "account-exists" | "check-email";
  email: string;
}
export interface AccountExistsResponse {
  exists: boolean;
  hasPublicProfile: boolean;
  hasAuthAccount: boolean;
}

export interface EnsureProfileRequest {
  action: "ensure-profile";
  accessToken: string;
}
export interface EnsureProfileResponse {
  ok: true;
  created: boolean;
}

export interface DeleteAccountRequest {
  action?: "delete";
  accessToken: string;
}
export interface DeleteAccountResponse {
  deleted: true;
}

export interface TurnResponse {
  iceServers: { urls: string[] | string; username?: string; credential?: string }[];
}

/* ------------------------------------------------------------- auth-otp */

export type AuthOtpRequest =
  | { action?: "send"; accessToken: string }
  | { action: "verify"; accessToken: string; code: string }
  | { action: "set-password"; accessToken: string; password: string };
export type AuthOtpResponse = { ok: true; otpRequired?: boolean } | { ok: false; error: string };

/* ----------------------------------------------------------------- Levi */

export interface LeviMessage {
  role: "user" | "assistant";
  content: string;
}
export interface LeviChatRequest {
  messages: LeviMessage[];
  accessToken: string;
  lat?: number;
  lng?: number;
  currentView?: string;
  currentViewParams?: Record<string, unknown>;
  lastRenderError?: string;
  mode?: "message_suggestions";
}
export interface LeviChatResponse {
  reply: string;
}
export interface LeviSuggestionsResponse {
  suggestions: string[];
}
export interface LeviTranscribeRequest {
  mode: "transcribe";
  accessToken: string;
  /** base64 WAV, at most 3,000,000 characters */
  audio: string;
}
export interface LeviTranscribeResponse {
  text: string;
}

/* ------------------------------------------------------------- payments */

export interface InitiatePaymentRequest {
  orderId: string;
  accessToken: string;
}
export interface PaystackCheckoutResponse {
  authorization_url: string;
  reference: string;
}
export interface VerifyPaymentResponse {
  status: string;
}

/* --------------------------------------------------------------- orders */

export interface OrderPayoutActionRequest {
  action?: "release" | "refund" | "mark-manual" | "buyer-cancel" | "vendor-decline";
  orderId: string;
  accessToken: string;
  reason?: string;
}

/* -------------------------------------------------------------- notify */

export type NotifyRequest =
  | { action: "test-push"; accessToken: string }
  | { action: "decline-call"; callId: string; token: string };
export interface PushResult {
  sent: number;
  reason?: string;
  results?: { kind: string; ok: boolean; status?: number }[];
}

/* ------------------------------------------------------ vendor-payments */

export type VendorPaymentsAction =
  | "create-subaccount"
  | "pay-commission"
  | "setup-monthly-billing"
  | "pay-listing"
  | "verify-listing-payment"
  | "consume-listing-payment"
  | "prepare-listing-payment"
  | "r2-presign-upload"
  | "r2-migrate-file"
  | "r2-optimize-file";

export interface R2PresignRequest {
  action: "r2-presign-upload";
  accessToken: string;
  key: string;
  contentType: string;
}
export interface R2PresignResponse {
  uploadUrl: string;
  publicUrl: string;
  cacheControl: string;
}

export interface ListingPaymentRequest {
  action: "pay-listing";
  accessToken: string;
  kind: "product" | "package";
  id: string;
}
export type ListingPaymentResponse =
  | { authorization_url: string; reference: string; amount: number }
  | { alreadyActive: true; paidUntil?: string };
