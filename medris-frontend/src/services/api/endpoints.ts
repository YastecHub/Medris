import type {
  AccountExistsResponse,
  EnsureProfileResponse,
  LeviChatResponse,
  LeviMessage,
  LeviSuggestionsResponse,
  PaystackCheckoutResponse,
  PushResult,
  R2PresignResponse,
  TurnResponse,
  VerifyPaymentResponse,
} from "@medris/contracts";
import { apiRequest } from "./client";

/**
 * Typed wrappers for the backend endpoints, for code that has moved to
 * React/TypeScript. The legacy runtime keeps its own fetch calls to the same
 * URLs, so both paths hit identical server behaviour.
 */
export const api = {
  accountExists: (email: string) => apiRequest<AccountExistsResponse>("account-exists", { body: { action: "account-exists", email } }),
  ensureProfile: () => apiRequest<EnsureProfileResponse>("delete-account", { body: { action: "ensure-profile" }, authenticated: true }),
  iceServers: () => apiRequest<TurnResponse>("turn"),
  leviChat: (messages: LeviMessage[], context: { currentView?: string; lat?: number; lng?: number } = {}) =>
    apiRequest<LeviChatResponse>("chat", { body: { messages, ...context }, authenticated: true }),
  leviSuggestions: (messages: LeviMessage[]) =>
    apiRequest<LeviSuggestionsResponse>("chat", { body: { messages, mode: "message_suggestions" }, authenticated: true }),
  startOrderPayment: (orderId: string) => apiRequest<PaystackCheckoutResponse>("initiate-payment", { body: { orderId }, authenticated: true }),
  verifyPayment: (reference: string) => apiRequest<VerifyPaymentResponse>("verify-payment", { query: { reference } }),
  presignImageUpload: (key: string, contentType: string) =>
    apiRequest<R2PresignResponse>("vendor-payments", { body: { action: "r2-presign-upload", key, contentType }, authenticated: true }),
  sendTestPush: () => apiRequest<PushResult>("notify", { body: { action: "test-push" }, authenticated: true }),
} as const;

export type MedrisApi = typeof api;
