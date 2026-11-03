import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import api from "../services/api";
import {
  validCapabilities,
  validPage,
  type Capabilities,
  type CreateUser,
  type NativeService,
  type NativeManagement,
  type UserPage,
  type UserRow,
} from "./types";

const prefix = "/user-admin/";
const config =
  window.location.hostname === "users.i3alumba.ru"
    ? { baseURL: window.location.origin + "/api/" }
    : {};
const empty: UserPage = {
  count: 0,
  page: 1,
  page_size: 50,
  next_page: null,
  results: [],
};

function failure(error: unknown): string {
  if (!axios.isAxiosError(error))
    return "Access could not be verified. No user data is displayed.";
  const code = error.response?.data?.code;
  if (code === "stale_authority_epoch")
    return "Native authority changed. Refresh and review the pause before retrying.";
  if (code === "native_target_reserved")
    return "Running or unknown native operations still reserve this target. Manual changes are not safe.";
  if (code === "pause_owner_required")
    return "Only the administrator who paused this target can resume management.";
  if (error.response?.status === 412)
    return "The user changed elsewhere. Refresh and review before saving again.";
  if (code === "self_lockout")
    return "You cannot deactivate or demote your own administrator account.";
  if (code === "last_administrator")
    return "The last active administrator must be preserved.";
  if (code === "invalid_profile_or_password")
    return "Check the username, email and password requirements.";
  if (code === "username_conflict")
    return "This username already exists. Refresh the list before retrying.";
  if (code === "hosting_consumer_pending")
    return "Hosting permission editing is not available yet.";
  if (error.response?.status === 401 || error.response?.status === 403)
    return "Administrator access unavailable. No user data is displayed.";
  return "The result could not be confirmed. Refresh the user list; requests are not replayed automatically.";
}

export function useUsers() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<UserPage>(empty);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const busy = useRef(false);
  const invalidate = useCallback((message: string) => {
    sequence.current++;
    setCapabilities(null);
    setData(empty);
    setError(message);
    setLoading(false);
  }, []);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const caps = (
        await api.get<Capabilities>(prefix + "capabilities/", config)
      ).data;
      if (!validCapabilities(caps)) throw new Error("Invalid authority");
      if (caps.enabled !== true) {
        if (mounted.current && request === sequence.current)
          invalidate(
            "User administration is not enabled. No user data is displayed.",
          );
        return false;
      }
      const result = (
        await api.get<UserPage>(prefix + "users/", {
          ...config,
          params: { page },
        })
      ).data;
      if (!validPage(result)) throw new Error("Invalid matrix");
      if (!mounted.current || request !== sequence.current) return false;
      setCapabilities(caps);
      setData(result);
      setError(null);
      setLoading(false);
      return true;
    } catch (error) {
      if (mounted.current && request === sequence.current)
        invalidate(failure(error));
      return false;
    }
  }, [page, invalidate]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const focus = () => {
      void refresh();
    };
    const interval = window.setInterval(focus, 5000);
    window.addEventListener("focus", focus);
    return () => {
      mounted.current = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);
  const mutate = useCallback(
    async (
      url: string,
      payload: unknown,
      user?: UserRow,
      method: "post" | "patch" = "post",
    ) => {
      if (!capabilities || busy.current) return false;
      busy.current = true;
      setPending(true);
      try {
        await api.request({
          ...config,
          url: prefix + url,
          method,
          data: payload,
          headers: {
            "Idempotency-Key": crypto.randomUUID(),
            ...(user ? { "If-Match": user.etag } : {}),
          },
        });
        return await refresh();
      } catch (error) {
        if (mounted.current) invalidate(failure(error));
        return false;
      } finally {
        busy.current = false;
        if (mounted.current) setPending(false);
      }
    },
    [capabilities, refresh, invalidate],
  );
  return {
    data,
    capabilities,
    error,
    loading,
    pending,
    refresh,
    setPage,
    create: (payload: CreateUser) => mutate("users/", payload),
    manageNative: (
      user: UserRow,
      service: NativeService,
      snapshot: NativeManagement,
    ) =>
      mutate(
        `users/${user.id}/native/${service}/${snapshot.paused ? "resume" : "pause"}/`,
        { expected_epoch: snapshot.authority_epoch },
      ),
    update: (user: UserRow, payload: unknown) =>
      mutate(`users/${user.id}/`, payload, user, "patch"),
    activate: (user: UserRow) =>
      mutate(
        `users/${user.id}/${user.is_active ? "deactivate" : "reactivate"}/`,
        {},
        user,
      ),
  };
}
