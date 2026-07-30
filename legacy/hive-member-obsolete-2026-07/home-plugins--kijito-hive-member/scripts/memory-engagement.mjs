export function classifyMemorySignal(signal) {
  const type = signal.type;
  if (type === "false_or_outdated_memory") {
    return {
      tool: "kijito_correct",
      required: true,
      reason: "false_or_outdated_memories_must_be_corrected_not_faded",
    };
  }
  if (type === "obsolete_true_memory") {
    return {
      tool: "kijito_fade",
      required: true,
      reason: "obsolete_but_true_memories_should_be_faded",
    };
  }
  if (type === "living_state_update") {
    return {
      tool: "kijito_update",
      required: true,
      reason: "living_state_notes_should_be_updated_in_place",
    };
  }
  if ([
    "durable_decision",
    "verified_fact",
    "user_preference",
    "product_finding",
    "gate_handoff_state",
  ].includes(type)) {
    return {
      tool: "kijito_remember",
      required: true,
      metadata: {
        persona: signal.persona || "codex",
        project: signal.project || "Codex",
        model: signal.model || "current Codex model",
        basis: signal.basis || (type === "verified_fact" ? "observed" : "derived"),
        confidence: signal.confidence ?? (type === "user_preference" ? 0.9 : 0.8),
      },
      reason: "durable_session_signal_should_be_saved",
    };
  }
  return {
    tool: null,
    required: false,
    reason: "no_memory_action_required",
  };
}

export function planMemoryActions(signals) {
  return signals.map((signal) => ({
    signal,
    action: classifyMemorySignal(signal),
  }));
}

export function shouldDream({
  memoryWrites = 0,
  corrections = 0,
  qaSweep = false,
  deferredReason = "",
} = {}) {
  const meaningfulBatch = memoryWrites + corrections >= 3;
  if (qaSweep || meaningfulBatch) {
    return {
      shouldDream: !deferredReason,
      required: true,
      reason: deferredReason || (qaSweep ? "qa_sweep_completed" : "meaningful_memory_batch"),
    };
  }
  return {
    shouldDream: false,
    required: false,
    reason: "not_enough_memory_activity",
  };
}

export function stopChecklist({
  topic = "current work",
  memoryWrites = 0,
  corrections = 0,
  qaSweep = false,
  deferredReason = "",
} = {}) {
  const dream = shouldDream({ memoryWrites, corrections, qaSweep, deferredReason });
  return [
    `Kijito memory QA for ${topic}:`,
    "1. Recall the work topic and current gate.",
    "2. Save missing durable findings with kijito_remember.",
    "3. Correct false or outdated memories with kijito_correct.",
    "4. Fade obsolete-but-true memories with kijito_fade.",
    "5. Refresh living state with kijito_update.",
    dream.required
      ? `6. ${dream.shouldDream ? "Run kijito_dream." : `Record dream deferral: ${dream.reason}.`}`
      : "6. Run kijito_dream if this session created a meaningful memory batch.",
  ].join("\n");
}
