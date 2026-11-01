export interface Capabilities {
  administrator: true;
  node: "gamma";
  max_cpu: number;
  max_memory_gb: number;
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
