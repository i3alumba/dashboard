export interface Capabilities {
  administrator: true;
  node: "gamma";
  max_cpu: number | null;
  max_memory_gb: number | null;
  aggregate_budget?: { cpu: number | null; memory_gb: number | null };
  resources_editing_enabled?: boolean;
  gpu_shared?: true;
  gpus?: { id: string; name: string }[];
  host_resources?: { cpu: number; memory_gb: number } | null;
  domain_suffix: string;
  image: string;
  disk_quota: false;
  home_separate: true;
  root_persistence: "full";
  external_ingress_ready: boolean;
}
export interface PortSpec {
  protocol: "tcp" | "udp";
  public_port: number;
  target_port: number;
}
export interface Port extends PortSpec {
  id: string;
  status: "reserved" | "active" | "error";
  reachability: "not_checked" | "reachable" | "unreachable" | "unknown";
}
export interface Instance {
  id: string;
  name: string;
  domain: string;
  node: "gamma";
  status: "creating" | "running" | "stopped" | "error";
  cpu: number;
  memory_gb: number;
  gpu_ids?: string[];
  resource_version?: number;
  ports: Port[];
  created_at: string;
  updated_at: string;
  error: unknown;
}
export interface CreateInstance {
  name: string;
  domain: string;
  cpu: number;
  memory_gb: number;
  gpu_ids?: string[];
  root_password: string;
  ports: PortSpec[];
}
export interface PortCheck {
  available: boolean;
  reason: string;
  checks: Record<
    "alpha" | "gamma" | "registry",
    "free" | "conflict" | "unknown"
  >;
}
export const initialPort = (): PortSpec => ({
  protocol: "tcp",
  public_port: 3001,
  target_port: 22,
});
export const validPort = (port: PortSpec) =>
  Number.isInteger(port.public_port) &&
  port.public_port >= 3000 &&
  port.public_port <= 50000 &&
  Number.isInteger(port.target_port) &&
  port.target_port >= 1 &&
  port.target_port <= 65535;
export const validSubdomain = (value: string) =>
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value);
export const validPassword = (value: string) =>
  value.length >= 16 && value.length <= 256 && !/[\r\n\0:]/.test(value);

export const validCpu = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
export const validMemory = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value > 0 &&
  (Number.isInteger(value) || /^\d+(?:\.\d{1,3})?$/.test(String(value)));
export const validResources = (
  cpu: number,
  memory: number,
  caps: Capabilities,
) =>
  validCpu(cpu) &&
  validMemory(memory) &&
  (caps.max_cpu === null || cpu <= caps.max_cpu) &&
  (caps.max_memory_gb === null || memory <= caps.max_memory_gb);
export const gpuSupported = (caps: Capabilities) =>
  caps.resources_editing_enabled === true &&
  caps.gpu_shared === true &&
  Array.isArray(caps.gpus);
export const editableResources = (item: Instance, caps: Capabilities) =>
  gpuSupported(caps) &&
  Number.isSafeInteger(item.resource_version) &&
  (item.resource_version ?? -1) >= 0 &&
  Array.isArray(item.gpu_ids) &&
  ["running", "stopped"].includes(item.status);
