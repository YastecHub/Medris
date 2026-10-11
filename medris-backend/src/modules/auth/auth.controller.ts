import type { Request, Response } from "express";
import { controller, noContent, ok, redirect } from "../../shared/http/route.js";
import { getCookie } from "../../shared/http/cookies.js";
import { clientIp } from "../../shared/responses.js";
import type { RequestMeta } from "./auth.service.js";
import * as routes from "./auth.routes.js";
import { OAUTH_COOKIE, clearOAuthCookie, clearSessionCookie, sessionCookieName, setOAuthCookie, setSessionCookie } from "./session-cookie.js";

/** /api/v1/auth - see auth.routes.ts for the contract and auth.service.ts for the rules. Cookies and redirects are the only HTTP work here. */

const meta = (req: Request, res: Response): RequestMeta => ({ userAgent: req.get("user-agent"), ip: clientIp(req), logger: res.locals.logger });

export const authController = controller()
  .route(routes.getSession, ({ services, identity, res }) => ok(services.auth.sessionInfo(identity, res.locals.authMethod)))
  .route(routes.login, async ({ services, input, req, res }) => {
    const session = await services.auth.login(input.body, meta(req, res));
    setSessionCookie(res, services.config, session.token);
    return ok({ userId: session.userId, expiresAt: session.expiresAt });
  })
  .route(routes.logout, async ({ services, req, res }) => {
    await services.auth.logout(getCookie(req, sessionCookieName(services.config)));
    clearSessionCookie(res, services.config);
    return noContent();
  })
  .route(routes.logoutAll, async ({ services, user, res }) => {
    const result = await services.auth.logoutEverywhere(user());
    clearSessionCookie(res, services.config);
    return ok(result);
  })
  .route(routes.googleStart, ({ services, input, res }) => {
    const { url, flowCookie } = services.auth.googleStart(input.query.returnTo);
    setOAuthCookie(res, services.config, flowCookie);
    return redirect(url);
  })
  .route(routes.googleCallback, async ({ services, input, req, res }) => {
    const flowCookie = getCookie(req, OAUTH_COOKIE);
    clearOAuthCookie(res, services.config);
    const session = await services.auth.googleFinish(input.query, flowCookie, meta(req, res));
    setSessionCookie(res, services.config, session.token);
    return redirect(session.returnTo);
  });
