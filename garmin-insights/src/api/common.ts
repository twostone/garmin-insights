import { z } from "@hono/zod-openapi";
import { DATE_RE, isDate } from "../dates.ts";
import { SPORTS } from "../sport.ts";
import type { Context } from "hono";
import type { AppUser, Env } from "../types.ts";

export const errorSchema = z.object({ error: z.string() });
type JsonResponse<T extends z.ZodType> = { content: { "application/json": { schema: T } }; description: string };
export const json = <T extends z.ZodType>(schema: T, description = "OK"): JsonResponse<T> => ({ content: { "application/json": { schema } }, description });
// One JSON error body per status code, keyed by the literal codes so the typed handlers can return them.
export const errors = <C extends 400 | 404 | 409 | 422 | 502>(...codes: C[]) =>
  Object.fromEntries(codes.map((c) => [c, json(errorSchema, "Error")])) as { [K in C]: JsonResponse<typeof errorSchema> };

export const dateSchema = z.string().regex(DATE_RE).refine(isDate, "invalid date");
export const sportSchema = z.enum(SPORTS as unknown as [string, ...string[]]);
export const rangeQuery = z.object({ from: dateSchema.optional(), to: dateSchema.optional() });
/** Restricts an analysis to one of the user's own sports. */
export const customSportQuery = { custom_sport_id: z.coerce.number().int().positive().optional() };
export const idParam = z.object({ id: z.coerce.number().int().positive() });

/** The routes behind the listeners always have a user (the listener refuses the request otherwise). */
export const userOf = (c: Context<Env>): AppUser => c.get("user")!;

// Longest range the range queries accept (about 10 years): protects the DB from silly requests, not a business rule.
export const MAX_RANGE_DAYS = 3700;
