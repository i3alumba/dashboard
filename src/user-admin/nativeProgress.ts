import type { NativeState } from "./types";

const phases: Record<string, string> = {
  pending: "Pending",
  running: "Running",
  held: "Needs setup",
  outcome_unknown: "Outcome unknown",
  partial: "Partially confirmed",
  unsupported: "Unavailable",
  failed: "Needs attention",
  succeeded: "Confirmed",
  superseded: "Superseded",
  not_required: "Not provisioned",
};

export function nativeProgress(native: NativeState): string {
  if (
    native.status === "unsupported" &&
    native.reason === "revocation_deferred"
  )
    return "Native revocation deferred; existing credentials may still work";
  if (
    native.status === "unsupported" &&
    native.reason === "reenable_not_supported"
  )
    return "Re-enable requires operator attention";
  if (native.reason === "native_enable_pending") return "Bound; enable pending";
  if (["create", "bind", "enable"].includes(native.phase ?? "")) {
    if (["pending", "running"].includes(native.status))
      return "Preparing access";
    if (native.phase === "create" && native.status === "succeeded")
      return "Created; binding pending";
    if (native.desired === "enabled" && native.observed === "enabled") {
      if (native.status === "succeeded") return "Account configured";
      if (
        native.status === "partial" &&
        native.reason === "capability_unconfirmed"
      )
        return "Account configured; session guarantees unconfirmed";
    }
  }
  return phases[native.status] ?? "Unconfirmed";
}
