import { Hono } from "hono";
import { errorMessage, json, methodNotAllowed, readJsonBody } from "../../lib/http.js";
import { sendOtp, setPassword, verifyOtp } from "./auth-otp.service.js";

/** POST /api/auth-otp { action: "send" | "verify" | "set-password", accessToken, code?, password? } */
export const authOtpRoutes = new Hono().all("/auth-otp", async (c) => {
  if (c.req.method !== "POST") return methodNotAllowed(c);
  try {
    const body = await readJsonBody(c);
    const result =
      body.action === "verify" ? await verifyOtp(body) : body.action === "set-password" ? await setPassword(body) : await sendOtp(body);
    return json(c, result.status, result.body);
  } catch (err) {
    return json(c, 500, { error: errorMessage(err) || "Server error" });
  }
});
