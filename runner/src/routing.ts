import { TERMINAL_STAGES, type StageDef } from './config.js';
import type { ProductStatus } from './state.js';
import { addMinutes } from './util.js';

/**
 * How long a stage that routed back to itself without a poll interval waits before running again:
 * 1 h, then doubling per consecutive self-loop, capped at a day (a blocking chore wakes it earlier).
 */
export const SELF_LOOP_BACKOFF_MINUTES = 60;
export const SELF_LOOP_BACKOFF_MAX_MINUTES = 24 * 60;

export function selfLoopBackoffMinutes(previousSelfLoops: number): number {
  return Math.min(SELF_LOOP_BACKOFF_MINUTES * 2 ** Math.max(0, previousSelfLoops), SELF_LOOP_BACKOFF_MAX_MINUTES);
}

/**
 * How many times one stage may be entered within a release cycle (e.g. QA → build → QA → build …).
 * Every such hop is a "pass", so attempts reset; this is what stops a ping-pong from running forever.
 */
export const MAX_STAGE_VISITS = 6;

/** Stages whose entry means a version is out and live: the loop counters start over. (Not release_watch —
 * a review_fix ⇄ release_watch cycle of rejections must still hit the guard.) */
export const CYCLE_RESET_STAGES = new Set(['launch', 'grow']);

/** After this many consecutive self-loops without progress the product waits for the human instead. */
export const MAX_SELF_LOOPS = 5;

/** Does the routed value lead anywhere? A missing/unknown value with no default or next is a failed attempt, not "done". */
export function routeValueError(def: StageDef, fieldValue: string | undefined): string | undefined {
  if (!def.route || def.route.default || def.next) return undefined;
  if (fieldValue !== undefined && Object.hasOwn(def.route.map, fieldValue)) return undefined;
  return `${def.route.file} → "${def.route.field}" must be one of: ${Object.keys(def.route.map).join(', ')} (found ${fieldValue === undefined ? 'nothing' : JSON.stringify(fieldValue)})`;
}

export interface RouteDecision {
  stage: string;
  status: ProductStatus;
  wait_until?: string;
  reason: string;
}

/**
 * Where a product goes after a stage passed verification.
 * `fieldValue` is the stringified value of `route.field` read from `route.file`.
 */
export function resolveAfterPass(
  stageName: string,
  def: StageDef,
  stages: Record<string, StageDef>,
  fieldValue: string | undefined,
  now: Date,
  previousSelfLoops = 0,
): RouteDecision {
  let target = def.next;
  if (def.route) {
    const mapped = fieldValue !== undefined ? def.route.map[fieldValue] : undefined;
    target = mapped ?? def.route.default ?? def.next;
  }
  if (!target) return { stage: stageName, status: 'done', reason: 'no next stage' };
  if (TERMINAL_STAGES.has(target)) return { stage: target, status: 'done', reason: `terminal:${target}` };

  const targetDef = stages[target];
  if (target === stageName) {
    if (targetDef?.poll_minutes) {
      return { stage: target, status: 'waiting', wait_until: addMinutes(now, targetDef.poll_minutes).toISOString(), reason: 'poll' };
    }
    // Only a stage that proves progress (build) may loop straight back; anything else that routes to itself
    // (e.g. release waiting for a human) backs off instead of relaunching a paid session every heartbeat.
    if (!targetDef?.progress) {
      return { stage: target, status: 'waiting', wait_until: addMinutes(now, selfLoopBackoffMinutes(previousSelfLoops)).toISOString(), reason: 'self-loop backoff' };
    }
    return { stage: target, status: 'ready', reason: 'loop' };
  }
  if (targetDef?.enter_delay_minutes) {
    return { stage: target, status: 'waiting', wait_until: addMinutes(now, targetDef.enter_delay_minutes).toISOString(), reason: 'enter_delay' };
  }
  return { stage: target, status: 'ready', reason: 'advance' };
}

/**
 * A looping stage (build) must show measurable progress each session.
 * `prev` is the baseline recorded when the stage was entered (or after the last accepted session).
 */
export function progressOk(value: number, prev: number | undefined): boolean {
  return Number.isFinite(value) && value > (prev ?? 0);
}

/**
 * Back-off after a session was lost to a transient API/network error (outage, overload, Mac offline).
 * `consecutive` counts this one. The first `free` such losses are not held against the product;
 * after that the attempt counts like any other failure so a persistent problem still ends in a park.
 */
export function apiBackoffMinutes(consecutive: number, free = 3): number | undefined {
  if (consecutive < 1 || consecutive > free) return undefined;
  return Math.min(15 * 2 ** (consecutive - 1), 120);
}

/** Where a product goes after a failed attempt. */
export function resolveAfterFail(
  stageName: string,
  def: StageDef,
  attempts: number,
  replans: number,
  maxReplans: number,
): RouteDecision {
  if (attempts < def.max_attempts) return { stage: stageName, status: 'ready', reason: 'retry' };
  const ex = def.on_exhausted;
  if (ex === 'kill') return { stage: 'killed', status: 'done', reason: 'exhausted→kill' };
  if (ex.startsWith('goto:')) {
    if (replans >= maxReplans) return { stage: stageName, status: 'failed', reason: 'exhausted→park (replan limit)' };
    return { stage: ex.slice(5), status: 'ready', reason: 'exhausted→replan' };
  }
  return { stage: stageName, status: 'failed', reason: 'exhausted→park' };
}
