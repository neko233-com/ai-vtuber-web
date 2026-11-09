/**
 * ai-vtuber-web — living-presence layer for LivLiv Player.
 *
 * Makes a web VTuber feel alive: idle behavior, and reactions to clicks,
 * hovers, scroll and idle time — via a pure frontend rules engine or an
 * LLM agent brain (bring your own endpoint).
 */

// Core orchestrator
export { LivePresence } from "./core/LivePresence";
export { PageSensor } from "./core/PageSensor";
export { Reactor } from "./core/Reactor";

// Strategies
export { RuleStrategy, DEFAULT_RULES } from "./strategies/RuleStrategy";
export { AgentStrategy } from "./strategies/AgentStrategy";
export type { RuleStrategyOptions } from "./strategies/RuleStrategy";
export type { AgentStrategyOptions } from "./strategies/AgentStrategy";

// Types
export type {
  PresenceMode,
  PageEvent,
  PageEventType,
  EventTargetSummary,
  Reaction,
  Strategy,
  StrategyContext,
  PlayerLike,
  Frame,
  ChatMessage,
  ChatFn,
  AgentConfig,
  LivePresenceConfig,
  PresenceEventHooks,
  RuleOverrides,
  RuleEntry,
} from "./types";

// Utils worth exposing
export { createBudget } from "./util/throttle";
export type { Budget, BudgetOptions } from "./util/throttle";
export { clamp } from "./util/clamp";
export { pick, jitter } from "./util/rng";
