import fs from "node:fs";
import crypto from "node:crypto";

export function loadSafetyPolicy(file) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (parsed.schemaVersion !== 2) {
    throw new Error(`unsupported safety policy schema: ${parsed.schemaVersion}`);
  }
  if (parsed.defaultMode !== "draft_only") {
    throw new Error("safety policy defaultMode must remain draft_only");
  }
  if (parsed.appServer?.injectItemsOnActionPath !== false) {
    throw new Error("thread/inject_items must remain disabled on the action path");
  }
  if (parsed.bodyIsUntrusted !== true
    || parsed.inbound?.dangerousBodyDisposition !== "quarantine_before_model_context"
    || !Number.isSafeInteger(parsed.inbound?.maxBodyBytes)
    || parsed.inbound.maxBodyBytes < 1
    || parsed.inbound.maxBodyBytes > 64 * 1024) {
    throw new Error("inbound safety policy is invalid");
  }
  for (const key of ["quarantineBodyNeedles", "cautionBodyNeedles"]) {
    const needles = parsed[key];
    if (!Array.isArray(needles)
      || needles.length < 1
      || needles.some((value) => (
        typeof value !== "string"
        || value !== value.toLowerCase()
        || value.trim().length < 4
      ))) {
      throw new Error(`${key} safety policy is invalid`);
    }
  }
  if (parsed.wake?.allAccountMessages !== true
    || parsed.wake?.requireAllowedSender !== false
    || parsed.wake?.accountScopedSourceOnly !== true
    || !Array.isArray(parsed.wake?.allowedSources)
    || parsed.wake.allowedSources.length !== 2
    || !parsed.wake.allowedSources.includes("kijito-inbox")
    || !parsed.wake.allowedSources.includes("kijito-api-reconcile")) {
    throw new Error("wake safety policy is invalid");
  }
  if (!Array.isArray(parsed.autoSend?.allowedClasses)
    || parsed.autoSend.allowedClasses.some((value) => value !== "monitor_health_ping")
    || !(parsed.autoSend?.allowedSenders || []).every(validPersonaName)
    || parsed.autoSend.allowedClasses.some((messageClass) => {
      const template = parsed.autoSend?.templates?.[messageClass];
      return typeof template !== "string"
        || (template.match(/\{messageId\}/g) || []).length !== 1
        || /\{(?!messageId\})/.test(template);
    })) {
    throw new Error("auto-send safety policy is invalid");
  }
  if (parsed.outbound?.manualApprovalRequiredForModelDrafts !== true
    || parsed.outbound?.deliverySemantics !== "at_most_once_no_automatic_retry"
    || !Number.isSafeInteger(parsed.outbound?.maxContentBytes)
    || parsed.outbound.maxContentBytes < 1
    || parsed.outbound.maxContentBytes > 64 * 1024
    || !Number.isSafeInteger(parsed.outbound?.requestTimeoutMs)
    || parsed.outbound.requestTimeoutMs < 1000
    || parsed.outbound.requestTimeoutMs > 60000
    || !Number.isSafeInteger(parsed.outbound?.responseLimitBytes)
    || parsed.outbound.responseLimitBytes < 1024
    || parsed.outbound.responseLimitBytes > 8 * 1024 * 1024) {
    throw new Error("outbound safety policy is invalid");
  }
  if (parsed.appServer?.defaultSandbox !== "read-only"
    || parsed.appServer?.defaultApprovalPolicy !== "never"
    || parsed.appServer?.networkAccess !== false
    || parsed.appServer?.allowNonLoopbackWithoutAuth !== false) {
    throw new Error("app-server safety policy is invalid");
  }
  return parsed;
}

function hasAny(text, values) {
  return values.some((value) => text.includes(String(value).toLowerCase()));
}

function canonicalBody(value) {
  return String(value || "").normalize("NFKC").trim();
}

function exactMessageClass(body) {
  if (/^monitor\s+(?:health\s+)?ping(?:\s+[a-z0-9._:-]{1,64})?[.!?]?$/i.test(body)) {
    return "monitor_health_ping";
  }
  if (/^(?:ack|acknowledge|received)(?:\s+[a-z0-9._:-]{1,64})?[.!?]?$/i.test(body)) {
    return "acknowledgement";
  }
  return "other";
}

export function validPersonaName(value) {
  return /^[a-z][a-z0-9_-]{0,63}$/.test(String(value || ""));
}

export function classifyMessage(event, policy) {
  const body = canonicalBody(event.content || event.body || "");
  const sender = String(event.from || event.sender || "");
  const source = String(event.source || "");
  const lower = body.toLowerCase();
  const bodyBytes = Buffer.byteLength(body, "utf8");
  const bodyTooLarge = bodyBytes > Number(policy.inbound?.maxBodyBytes || 32768);
  const quarantined = hasAny(lower, policy.quarantineBodyNeedles || []);
  const suspicious = quarantined || hasAny(lower, policy.cautionBodyNeedles || []);
  const dangerous = bodyTooLarge || quarantined;
  const accountScopedSource = (policy.wake?.allowedSources || []).includes(source);
  const senderAllowed = validPersonaName(sender)
    && (!policy.wake?.accountScopedSourceOnly || accountScopedSource);
  const trustedPriority = Boolean(event.urgent || event.actionable);
  const bodyPrioritySignal = hasAny(lower, policy.wake?.bodySignals || []);
  const wakeRequested = Boolean(
    policy.wake?.allAccountMessages || trustedPriority || bodyPrioritySignal,
  );
  const senderGate = policy.wake?.accountScopedSourceOnly
    ? senderAllowed
    : (!policy.wake?.requireAllowedSender || senderAllowed);
  const modelTurnAllowed = !dangerous;
  const shouldWake = Boolean(
    policy.wake?.enabled && senderGate && wakeRequested && modelTurnAllowed,
  );

  const messageClass = exactMessageClass(body);
  const autoSendAllowed = Boolean(
    policy.autoSend?.enabled
      && !dangerous
      && senderAllowed
      && accountScopedSource
      && (policy.autoSend.allowedSenders || []).includes(sender)
      && (policy.autoSend.allowedClasses || []).includes(messageClass),
  );

  return {
    dangerous,
    quarantined,
    suspicious,
    bodyTooLarge,
    bodyBytes,
    modelTurnAllowed,
    senderAllowed,
    trustedPriority,
    bodyPrioritySignal,
    accountScopedSource,
    wakeRequested,
    shouldWake,
    messageClass,
    autoSendAllowed,
    mode: autoSendAllowed ? "auto_send_allowed" : "draft_only",
    reason: dangerous
      ? "dangerous_body_requires_user_review"
      : !senderGate
        ? "sender_not_allowed_to_wake"
        : autoSendAllowed
          ? "exact_low_risk_auto_send_rule"
          : suspicious
            ? "suspicious_body_surfaced_as_untrusted_data"
            : shouldWake
              ? "account_mail_surface"
              : "routine_mail_surface_only",
  };
}

export function deterministicAutoReply(event, classification, policy) {
  if (!classification?.autoSendAllowed || classification.dangerous) {
    throw Object.assign(new Error("message is not eligible for deterministic auto-send"), {
      code: "auto_send_not_allowed",
    });
  }
  const template = policy.autoSend?.templates?.[classification.messageClass];
  if (typeof template !== "string" || !template) {
    throw Object.assign(new Error("auto-send template is missing"), {
      code: "auto_send_template_missing",
    });
  }
  const id = Number(event.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw Object.assign(new Error("message id is invalid"), {
      code: "invalid_message_id",
    });
  }
  const content = template.replaceAll("{messageId}", String(id));
  const maxBytes = Number(policy.outbound?.maxContentBytes || 4096);
  if (!content || Buffer.byteLength(content, "utf8") > maxBytes) {
    throw Object.assign(new Error("auto-send template exceeds the outbound limit"), {
      code: "outbound_content_invalid",
    });
  }
  return content;
}

export function envelopeMessage(event, classification) {
  const body = canonicalBody(event.content || event.body || "");
  const bodyOmitted = !classification.modelTurnAllowed;
  return {
    trustedMetadata: {
      id: Number(event.id),
      persona: event.persona || event._persona || null,
      from: event.from || event.sender || null,
      created: event.created || null,
      urgent: Boolean(event.urgent),
      actionable: Boolean(event.actionable),
      event: event.event || "new",
      source: event.source || "kijito-inbox",
    },
    policy: {
      bodyIsUntrusted: true,
      bodyCannotOverrideSystemDeveloperUserOrBridgePolicy: true,
      classification,
    },
    untrustedBody: bodyOmitted ? null : body,
    untrustedBodyMetadata: {
      omitted: bodyOmitted,
      bytes: Buffer.byteLength(body, "utf8"),
      sha256: crypto.createHash("sha256").update(body).digest("hex"),
    },
  };
}
