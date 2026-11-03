export const serviceLabels = {
  drive: "Drive",
  matrix: "Matrix",
  gitlab: "GitLab",
  minio: "MinIO",
  monitor: "Monitor",
  hosting: "Hosting",
  jenkins: "Jenkins",
} as const;
export type ServiceSlug = keyof typeof serviceLabels;
export type MutableService = Exclude<ServiceSlug, "jenkins">;
export interface ServiceCell {
  assigned: boolean;
  granted: boolean;
  effective: boolean;
  readonly: boolean;
}
export type NativeService = "gitlab" | "matrix" | "minio";
export interface NativeManagement {
  can_manage: boolean;
  paused: boolean;
  authority_epoch: number;
  pause_actor_id: number | null;
  safe_for_manual_changes: boolean;
}
export interface NativeState {
  desired: string;
  observed: string;
  status: string;
  reason: string;
  phase?: string;
  management?: NativeManagement;
}
export interface UserRow {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  is_admin: boolean;
  is_active: boolean;
  version: number;
  etag: string;
  services: Record<ServiceSlug, ServiceCell>;
  native: Partial<Record<ServiceSlug, NativeState>>;
}
export interface Capabilities {
  administrator: boolean;
  enabled: boolean;
  actor_id: number;
  native_execution_enabled: boolean;
  native_adapters_accepted: boolean;
  editable_services: MutableService[];
  readonly_services: ServiceSlug[];
}
export interface UserPage {
  count: number;
  page: number;
  page_size: number;
  next_page: number | null;
  results: UserRow[];
}
export interface CreateUser {
  username: string;
  email: string;
  password: string;
  is_admin: boolean;
  services: Partial<Record<MutableService, boolean>>;
}

export function validCapabilities(value: Capabilities): boolean {
  return (
    value?.administrator === true &&
    typeof value.enabled === "boolean" &&
    Number.isInteger(value.actor_id) &&
    value.actor_id > 0 &&
    typeof value.native_execution_enabled === "boolean" &&
    typeof value.native_adapters_accepted === "boolean" &&
    Array.isArray(value.editable_services) &&
    value.editable_services.every(
      (slug) => slug in serviceLabels && slug !== ("jenkins" as string),
    ) &&
    Array.isArray(value.readonly_services) &&
    value.readonly_services.every((slug) => slug in serviceLabels)
  );
}

export function validPage(value: UserPage): boolean {
  return (
    Array.isArray(value?.results) &&
    Number.isInteger(value.count) &&
    value.count >= 0 &&
    Number.isInteger(value.page) &&
    value.page > 0 &&
    value.page_size === 50 &&
    (value.next_page === null ||
      (Number.isInteger(value.next_page) && value.next_page > value.page)) &&
    value.results.every(
      (user) =>
        user &&
        Number.isInteger(user.id) &&
        user.id > 0 &&
        Number.isInteger(user.version) &&
        user.version >= 0 &&
        typeof user.native === "object" &&
        user.native !== null &&
        !Array.isArray(user.native) &&
        Object.entries(user.native).every(
          ([slug, state]) =>
            Object.hasOwn(serviceLabels, slug) &&
            state !== null &&
            state !== undefined &&
            typeof state === "object" &&
            [state.desired, state.observed, state.status, state.reason].every(
              (v) => typeof v === "string",
            ) &&
            (state.management === undefined ||
              (["gitlab", "matrix", "minio"].includes(slug) &&
                state.management !== null &&
                typeof state.management === "object" &&
                typeof state.management.can_manage === "boolean" &&
                typeof state.management.paused === "boolean" &&
                Number.isSafeInteger(state.management.authority_epoch) &&
                state.management.authority_epoch >= 0 &&
                (state.management.pause_actor_id === null ||
                  (Number.isSafeInteger(state.management.pause_actor_id) &&
                    state.management.pause_actor_id > 0)) &&
                typeof state.management.safe_for_manual_changes === "boolean")),
        ) &&
        typeof user.username === "string" &&
        typeof user.email === "string" &&
        typeof user.first_name === "string" &&
        typeof user.last_name === "string" &&
        typeof user.is_admin === "boolean" &&
        typeof user.is_active === "boolean" &&
        /^"[a-f0-9]{64}"$/.test(user.etag) &&
        Object.keys(serviceLabels).every((slug) => {
          const cell = user.services?.[slug as ServiceSlug];
          return (
            cell &&
            [cell.assigned, cell.granted, cell.effective, cell.readonly].every(
              (v) => typeof v === "boolean",
            )
          );
        }),
    )
  );
}
