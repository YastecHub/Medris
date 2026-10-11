import type { RouteConfig } from "@asteasolutions/zod-to-openapi";
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import type { z } from "zod";
import type { AppServices } from "../../container.js";
import type { Identity } from "../../database/context.js";
import type { Logger } from "../../lib/logger.js";
import { unauthenticated, validationFailed } from "../errors/app-error.js";
import { issuesOf } from "../validation/index.js";

/**
 * Controllers on Express, described by OpenAPI route definitions.
 *
 * A route definition (`<module>.routes.ts`) is a zod-to-openapi RouteConfig
 * plus the Express middleware it needs. `controller().route(def, handler)`
 * mounts it on an Express router and keeps the definition for the API docs,
 * so the documentation and the routing come from the same object:
 *
 *   1. the definition's middleware run (requireUser, rate limits, ...);
 *   2. params, query and JSON body are validated with the definition's Zod
 *      schemas - failures become 400 `validation_failed` with [{ path, message }];
 *   3. the handler gets the parsed input and returns a reply (ok, created,
 *      noContent, redirect), typed against the definition's success response.
 */

export type RouteDefinition = RouteConfig & { middleware?: readonly RequestHandler[] };

/** Keeps the literal types of a route definition (for typed handlers). */
export function defineRoute<const R extends RouteDefinition>(definition: R): R {
  return definition;
}

/* ------------------------------------------------------------------ typing */

type Out<S> = S extends z.ZodType ? z.output<S> : undefined;
type ParamsOf<R> = R extends { request: { params: infer S } } ? Out<S> : Record<string, never>;
type QueryOf<R> = R extends { request: { query: infer S } } ? Out<S> : Record<string, never>;
type BodyOf<R> = R extends { request: { body: { content: { "application/json": { schema: infer S } } } } } ? Out<S> : undefined;
type JsonOf<X> = X extends { content: { "application/json": { schema: infer S } } } ? Out<S> : never;
/** The JSON body of the definition's 2xx/503 responses (what a handler may send). */
type SuccessBody<R> = R extends { responses: infer Rs }
  ? { [K in keyof Rs]: K extends 200 | 201 | 503 | "200" | "201" | "503" ? JsonOf<Rs[K]> : never }[keyof Rs]
  : never;

export interface RouteInput<R> {
  params: ParamsOf<R>;
  query: QueryOf<R>;
  body: BodyOf<R>;
}

export interface HandlerContext<R> {
  input: RouteInput<R>;
  req: Request;
  res: Response;
  services: AppServices;
  identity: Identity | null;
  logger: Logger;
  /** The signed-in caller; routes that use it list `requireUser` in their middleware. */
  user(): Identity;
}

export type Reply<B = unknown> =
  | { kind: "json"; status: number; body: B }
  | { kind: "empty"; status: 204 }
  | { kind: "redirect"; status: 302; location: string };

export type Handler<R> = (ctx: HandlerContext<R>) => Reply<SuccessBody<R>> | Promise<Reply<SuccessBody<R>>>;

/* ----------------------------------------------------------------- replies */

/** 200 `{ "data": ... }`, never cached. */
export const ok = <T>(data: T): Reply<{ data: T }> => ({ kind: "json", status: 200, body: { data } });
/** 201 `{ "data": ... }`. */
export const created = <T>(data: T): Reply<{ data: T }> => ({ kind: "json", status: 201, body: { data } });
/** A body that is not wrapped (health checks). */
export const json = <T>(body: T, status = 200): Reply<T> => ({ kind: "json", status, body });
export const noContent = (): Reply<never> => ({ kind: "empty", status: 204 });
export const redirect = (location: string): Reply<never> => ({ kind: "redirect", status: 302, location });

function send(res: Response, reply: Reply): void {
  if (res.headersSent) return; // e.g. the request timeout already answered
  if (!res.getHeader("Cache-Control")) res.setHeader("Cache-Control", "no-store");
  if (reply.kind === "redirect") res.redirect(302, reply.location);
  else if (reply.kind === "empty") res.status(204).end();
  else res.status(reply.status).json(reply.body);
}

/* -------------------------------------------------------------- validation */

function parse<T>(schema: z.ZodType<T> | undefined, value: unknown): T {
  if (!schema) return undefined as T;
  const result = schema.safeParse(value);
  if (!result.success) throw validationFailed(issuesOf(result.error));
  return result.data;
}

function jsonSchemaOf(def: RouteDefinition): z.ZodType | undefined {
  const content = def.request?.body?.content?.["application/json"];
  return content && "schema" in content ? (content.schema as z.ZodType) : undefined;
}

/** `/cart/items/{id}` (OpenAPI) -> `/cart/items/:id` (Express). */
export function expressPath(openApiPath: string): string {
  return openApiPath.replace(/\{(\w+)\}/g, ":$1");
}

/* -------------------------------------------------------------- controller */

export interface Controller {
  readonly router: Router;
  /** The definitions mounted on this router (for the OpenAPI document). */
  readonly definitions: RouteDefinition[];
  route<const R extends RouteDefinition>(definition: R, handler: Handler<R>): Controller;
}

export function controller(): Controller {
  const router = Router();
  const definitions: RouteDefinition[] = [];
  const self: Controller = {
    router,
    definitions,
    route(definition, handler) {
      definitions.push(definition);
      const bodySchema = jsonSchemaOf(definition);
      const run = async (req: Request, res: Response, _next: NextFunction) => {
        const input = {
          params: parse(definition.request?.params as z.ZodType | undefined, req.params),
          query: parse(definition.request?.query as z.ZodType | undefined, req.query),
          body: parse(bodySchema, req.body ?? {}),
        } as RouteInput<typeof definition>;
        const locals = res.locals;
        const reply = await handler({
          input,
          req,
          res,
          services: locals.services,
          identity: locals.identity,
          logger: locals.logger,
          user: () => {
            if (!locals.identity) throw unauthenticated();
            return locals.identity;
          },
        });
        send(res, reply as Reply);
      };
      const method = definition.method as "get" | "post" | "put" | "patch" | "delete";
      router[method](expressPath(definition.path), ...(definition.middleware ?? []), run);
      return self;
    },
  };
  return self;
}
