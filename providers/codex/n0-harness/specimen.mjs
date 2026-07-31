import { renderPrompt } from "./prompt.mjs";
import { requiredCaseNames, validateSpecimen } from "./oracle.mjs";
import { requireNonce, requireSafeInteger, sha256 } from "./lib.mjs";

export function buildSpecimen(input) {
  const specimen = structuredClone(input);
  specimen.prompts = {};
  for (const name of requiredCaseNames()) {
    const utf8 = renderPrompt(specimen, name);
    specimen.prompts[name] = { utf8, sha256: sha256(Buffer.from(utf8, "utf8")) };
  }
  return validateSpecimen(specimen);
}

export function buildMailFixtureRequest({ bodyNonce }) {
  requireNonce(bodyNonce, "MAIL_FIXTURE_NONCE", "mail fixture body nonce");
  return Object.freeze({
    operation: "kijito_hive_send",
    persona: "codex-n0",
    to: "codex-n0",
    urgent: false,
    content: `N0_SYNTHETIC_MAIL_V1 ${bodyNonce}`,
  });
}

export function buildMailCleanupRequest({ rowId }) {
  requireSafeInteger(rowId, "MAIL_FIXTURE_ROW", "mail fixture row id");
  return Object.freeze({
    operation: "kijito_hive_inbox",
    persona: "codex-n0",
    before_id: rowId + 1,
    limit: 1,
    mark_read: true,
    expected_id: rowId,
    allowed_only_after_manifest_freeze: true,
  });
}
