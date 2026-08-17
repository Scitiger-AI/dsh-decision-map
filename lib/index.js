// dsh-decision-map — node half.
//
// Registers the `decisionMap` session projection: a pure, synchronous fold of
// the raw session event log (`turn/*`, `step/*`, `assistant/chunk`,
// `assistant/message`, `tool/call`, `tool/result`) into two minimal shapes:
//
//   1. `timeline` — one node per observable agent action, in log order:
//        - `think`  : a step produced reasoning (思考)
//        - `tool`   : a tool call (调工具)
//        - `write`  : a tool call to a file-mutating tool (`write` / `edit`)
//   2. `stats`   — whole-log totals: total/input/output tokens, tool-call
//        count, turn count, step count, and the most expensive step.
//
// The value is served to the browser through the session-projection seam (the
// api-proxy tail page + `session/projection` push frames), so the browser half
// needs no folding code of its own: it reads `useProjection("decisionMap")`.
//
// This package has NO runtime imports: the session event shapes are read as
// plain JSON, and the projection schema is a hand-rolled `.parse` validator
// (the seam only calls `schema.parse(value)`), so no `zod`, no build step,
// and no dependency for a `link:` install to fail to materialize.

/** Cordis plugin name (used in diagnostics). */
const name = "decision-map";

/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
const inject = ["sessionProjections"];

/** Node kinds painted by the browser half. */
const NODE_TYPES = ["think", "tool", "write"];

/** Tool names treated as file mutations and painted as `write`. */
const FILE_WRITE_TOOLS = new Set(["write", "edit"]);

/** The `think` node label. */
const THINK_LABEL = "思考";

/** Ceiling for a node's carried `detail` (full content, not a preview). */
const DETAIL_CAP = 8000;

/** Hand-rolled wire validator: the seam only calls `schema.parse(value)`. */
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function fail(reason) {
  throw new Error("decisionMap: invalid projection value — " + reason);
}

const decisionMapSchema = {
  parse(value) {
    if (!isPlainObject(value)) fail("expected an object");
    const { timeline, stats } = value;

    if (!Array.isArray(timeline)) fail("timeline must be an array");
    for (const node of timeline) {
      if (!isPlainObject(node)) fail("timeline node must be an object");
      if (!NODE_TYPES.includes(node.type)) fail("unknown node type " + String(node.type));
      if (!isFiniteNumber(node.turn) || !isFiniteNumber(node.step) || !isFiniteNumber(node.seq) || !isFiniteNumber(node.time)) {
        fail("node turn/step/seq/time must be finite numbers");
      }
      if (node.durationMs !== null && !isFiniteNumber(node.durationMs)) fail("node durationMs must be null or a number");
      if (typeof node.label !== "string" || typeof node.detail !== "string") fail("node label/detail must be strings");
    }

    if (!isPlainObject(stats)) fail("stats must be an object");
    for (const key of ["totalTokens", "inputTokens", "outputTokens", "toolCalls", "turns", "steps"]) {
      const n = stats[key];
      if (!(typeof n === "number" && Number.isInteger(n) && n >= 0)) fail("stats." + key + " must be a non-negative integer");
    }
    const most = stats.mostExpensive;
    if (!isPlainObject(most)) fail("stats.mostExpensive must be an object");
    if (!isFiniteNumber(most.turn) || !isFiniteNumber(most.step) || !isFiniteNumber(most.durationMs) || typeof most.label !== "string") {
      fail("stats.mostExpensive fields are invalid");
    }

    return value;
  },
};

/** Coerce an unknown token figure to a non-negative integer (default 0). */
function toNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Bound raw text without collapsing whitespace (for accumulation). */
function cap(text, limit) {
  const s = typeof text === "string" ? text : "";
  return s.length <= limit ? s : s.slice(0, limit);
}

/** Carry full text up to a ceiling, marking a truncation with an ellipsis. */
function capFull(text, limit) {
  const s = typeof text === "string" ? text : String(text ?? "");
  return s.length <= limit ? s : s.slice(0, limit) + "…";
}

/** Read the callId off a `tool/result` message defensively. */
function resultCallId(data) {
  const message = data && data.message;
  const source = message && message.source;
  return source && typeof source.callId === "string" ? source.callId : undefined;
}

const decisionMapDefinition = {
  key: "decisionMap",
  schema: decisionMapSchema,
  init: () => ({
    timeline: [],
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    toolCalls: 0,
    turns: 0,
    steps: 0,
    mostExpensive: { turn: 0, step: 0, durationMs: 0, label: "" },
    // Step-local folding state (excluded from `view`).
    openStep: null,
    // callId -> timeline index of the still-open `tool/call` node.
    pendingCalls: {},
  }),
  apply: (state, event) => {
    switch (event.type) {
      case "turn/start": {
        return { ...state, turns: state.turns + 1 };
      }

      case "step/start": {
        return {
          ...state,
          openStep: {
            turn: event.data.turn,
            step: event.data.step,
            startTime: event.time,
            firstAnswerTime: null,
            thinkIndex: -1,
            reasoningText: "",
            firstTool: "",
          },
        };
      }

      case "assistant/chunk": {
        const open = state.openStep;
        if (open === null || open.turn !== event.data.turn || open.step !== event.data.step) return state;
        const chunk = event.data.chunk;
        if (chunk === null || typeof chunk !== "object") return state;

        if (chunk.type === "reasoning-delta") {
          const delta = typeof chunk.text === "string" ? chunk.text : "";
          if (open.thinkIndex === -1) {
            // First reasoning in the step: open a `think` node at this point.
            const node = {
              type: "think",
              turn: open.turn,
              step: open.step,
              seq: event.seq,
              time: event.time,
              durationMs: null,
              label: THINK_LABEL,
              detail: "",
            };
            return {
              ...state,
              timeline: state.timeline.concat([node]),
              openStep: { ...open, thinkIndex: state.timeline.length, reasoningText: cap(delta, DETAIL_CAP) },
            };
          }
          const combined = open.reasoningText + delta;
          if (combined === open.reasoningText) return state;
          return { ...state, openStep: { ...open, reasoningText: cap(combined, DETAIL_CAP) } };
        }

        if (open.firstAnswerTime === null && (chunk.type === "text-delta" || chunk.type === "tool-call-delta")) {
          // Time-to-first-answer marks the end of the thinking phase.
          return { ...state, openStep: { ...open, firstAnswerTime: event.time } };
        }
        return state;
      }

      case "assistant/message": {
        const usage = event.data.usage;
        if (usage === null || typeof usage !== "object") return state;
        const input = toNonNegative(usage.inputTokens) + toNonNegative(usage.cacheReadTokens) + toNonNegative(usage.cacheWriteTokens);
        const output = toNonNegative(usage.outputTokens);
        if (input === 0 && output === 0) return state;
        return {
          ...state,
          inputTokens: state.inputTokens + input,
          outputTokens: state.outputTokens + output,
          totalTokens: state.totalTokens + input + output,
        };
      }

      case "tool/call": {
        const toolName = typeof event.data.name === "string" ? event.data.name : "tool";
        const node = {
          type: FILE_WRITE_TOOLS.has(toolName) ? "write" : "tool",
          turn: event.data.turn,
          step: event.data.step,
          seq: event.seq,
          time: event.time,
          durationMs: null,
          label: toolName,
          detail: capFull(event.data.arguments, DETAIL_CAP),
        };
        const open = state.openStep;
        const sameStep = open !== null && open.turn === event.data.turn && open.step === event.data.step;
        return {
          ...state,
          toolCalls: state.toolCalls + 1,
          timeline: state.timeline.concat([node]),
          pendingCalls: { ...state.pendingCalls, [event.data.callId]: state.timeline.length },
          openStep: sameStep && open.firstTool === "" ? { ...open, firstTool: toolName } : open,
        };
      }

      case "tool/result": {
        const callId = resultCallId(event.data);
        if (callId === undefined) return state;
        const index = state.pendingCalls[callId];
        if (index === undefined) return state;
        const node = state.timeline[index];
        if (node === undefined) return state;
        const timeline = state.timeline.slice();
        timeline[index] = { ...node, durationMs: Math.max(0, event.time - node.time) };
        const pendingCalls = { ...state.pendingCalls };
        delete pendingCalls[callId];
        return { ...state, timeline, pendingCalls };
      }

      case "step/end": {
        const open = state.openStep;
        let next = { ...state, steps: state.steps + 1, openStep: null };
        if (open === null || open.turn !== event.data.turn || open.step !== event.data.step) return next;

        const stepDuration = Math.max(0, event.time - open.startTime);
        if (stepDuration > next.mostExpensive.durationMs) {
          next = {
            ...next,
            mostExpensive: {
              turn: open.turn,
              step: open.step,
              durationMs: stepDuration,
              label: open.firstTool !== "" ? open.firstTool : (open.thinkIndex >= 0 ? THINK_LABEL : ""),
            },
          };
        }

        // Finalize the step's `think` node: full reasoning + reasoning span.
        if (open.thinkIndex >= 0) {
          const think = next.timeline[open.thinkIndex];
          if (think !== undefined && think.type === "think") {
            const timeline = next.timeline.slice();
            timeline[open.thinkIndex] = {
              ...think,
              detail: capFull(open.reasoningText, DETAIL_CAP),
              durationMs: open.firstAnswerTime !== null ? Math.max(0, open.firstAnswerTime - think.time) : null,
            };
            next = { ...next, timeline };
          }
        }
        return next;
      }

      default:
        return state;
    }
  },
  view: (state) => ({
    timeline: state.timeline,
    stats: {
      totalTokens: state.totalTokens,
      inputTokens: state.inputTokens,
      outputTokens: state.outputTokens,
      toolCalls: state.toolCalls,
      turns: state.turns,
      steps: state.steps,
      mostExpensive: state.mostExpensive,
    },
  }),
  stateVersion: 1,
};

/**
 * Register the `decisionMap` unit. Registration is an effect on this plugin's
 * fiber (the registry owns the disposer), so unloading the plugin removes the
 * key and its cached cells.
 */
function apply(ctx) {
  ctx.sessionProjections.register(decisionMapDefinition);
}

export { apply, inject, name };
