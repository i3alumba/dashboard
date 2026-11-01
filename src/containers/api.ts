import axios from "axios";
import api from "../services/api";
import type { Capabilities, Instance, PortCheck, Port } from "./types";

// Absolute same-origin URL overrides the Auth baseURL, retaining its JWT/refresh interceptors.
const baseURL = new URL("/api/containers/", window.location.origin).href;
export async function containerRequest(
  path: string,
  signal: AbortSignal,
  method = "GET",
  data?: unknown,
): Promise<unknown> {
  const response = await api.request({
    url: baseURL + path,
    method,
    data,
    signal,
    withCredentials: false,
  });
  return response.data;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export function parseCapabilities(value: unknown): Capabilities {
  if (
    !object(value) ||
    value.administrator !== true ||
    value.node !== "gamma" ||
    !Number.isInteger(value.max_cpu) ||
    (value.max_cpu as number) < 1 ||
    (value.max_cpu as number) > 4 ||
    typeof value.max_memory_gb !== "number" ||
    value.max_memory_gb <= 0 ||
    value.max_memory_gb > 16 ||
    typeof value.domain_suffix !== "string" ||
    value.domain_suffix.length > 189 ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
      value.domain_suffix,
    ) ||
    typeof value.image !== "string" ||
    value.disk_quota !== false ||
    value.home_separate !== true ||
    value.root_persistence !== "full" ||
    typeof value.external_ingress_ready !== "boolean"
  )
    throw new Error("Invalid capabilities");
  return value as unknown as Capabilities;
}
const uuid = (v: unknown) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const portNumber = (v: unknown) =>
  Number.isInteger(v) && (v as number) > 0 && (v as number) <= 65535;
function isPort(v: unknown): v is Port {
  return (
    object(v) &&
    uuid(v.id) &&
    (v.protocol === "tcp" || v.protocol === "udp") &&
    portNumber(v.public_port) &&
    portNumber(v.target_port) &&
    ["reserved", "active", "error"].includes(v.status as string) &&
    ["not_checked", "reachable", "unreachable", "unknown"].includes(
      v.reachability as string,
    )
  );
}
export function parseInstance(value: unknown): Instance {
  if (
    !object(value) ||
    !uuid(value.id) ||
    typeof value.name !== "string" ||
    !/^[a-z][a-z0-9-]{0,31}$/.test(value.name) ||
    typeof value.domain !== "string" ||
    value.node !== "gamma" ||
    !["creating", "running", "stopped", "error"].includes(
      value.status as string,
    ) ||
    !Number.isInteger(value.cpu) ||
    (value.cpu as number) < 1 ||
    (value.cpu as number) > 4 ||
    typeof value.memory_gb !== "number" ||
    value.memory_gb <= 0 ||
    value.memory_gb > 16 ||
    !Array.isArray(value.ports) ||
    !value.ports.every(isPort) ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string"
  )
    throw new Error("Invalid instance");
  return value as unknown as Instance;
}
export function parseInventory(value: unknown): Instance[] {
  if (!object(value) || !Array.isArray(value.instances))
    throw new Error("Invalid inventory");
  return value.instances.map(parseInstance);
}
export function parseCheck(value: unknown): PortCheck {
  if (
    !object(value) ||
    typeof value.available !== "boolean" ||
    typeof value.reason !== "string" ||
    !object(value.checks)
  )
    throw new Error("Inspection unavailable");
  const checks = {} as PortCheck["checks"];
  for (const host of ["alpha", "gamma", "registry"] as const) {
    const check = value.checks[host];
    checks[host] =
      object(check) && (check.status === "free" || check.status === "conflict")
        ? check.status
        : "unknown";
  }
  return {
    available:
      value.available === true &&
      Object.values(checks).every((status) => status === "free"),
    reason: "",
    checks,
  };
}
export const authorizationFailure = (error: unknown) =>
  axios.isAxiosError(error) && [401, 403].includes(error.response?.status ?? 0);
// Never reflect response bodies (including FastAPI validation inputs) into the UI.
export function safeError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 409)
      return "Port or resource conflict: the server could not reserve this allocation. Choose another port and check again.";
    if (error.response?.status === 503)
      return "Service or host inspection unavailable. Availability is unknown; retry later.";
    if (error.response?.status === 400 || error.response?.status === 422)
      return "The server rejected the request. Check the fields and retry.";
  }
  return "Request failed. Retry when the service is available.";
}
