import { useCallback, useEffect, useRef, useState } from "react";
import { getAccessToken } from "../utils/cookies";
import {
  authorizationFailure,
  containerRequest,
  parseCapabilities,
  parseInventory,
  safeError,
} from "./api";
import type { Capabilities, Instance } from "./types";
import { validSubdomain } from "./types";

export function useContainers(inventory = false) {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const controller = useRef(new AbortController());
  const epoch = useRef(0);
  const active = useRef(false);
  const granted = useRef(false);
  const mutation = useRef(false);
  const refreshing = useRef(0);
  const latestRead = useRef(0);

  const clear = useCallback(() => {
    epoch.current++;
    controller.current.abort();
    controller.current = new AbortController();
    granted.current = false;
    mutation.current = false;
    refreshing.current = 0;
    setCapabilities(null);
    setInstances([]);
    setPending(false);
  }, []);

  const refresh = useCallback(
    async (force = false) => {
      if ((refreshing.current > 0 && !force) || !active.current) return;
      refreshing.current++;
      const read = ++latestRead.current;
      const generation = epoch.current;
      const signal = controller.current.signal;
      const current = () => {
        if (!active.current || generation !== epoch.current || signal.aborted)
          return false;
        if (!getAccessToken()) {
          clear();
          setError("Session ended. Sign in again.");
          return false;
        }
        return true;
      };
      try {
        if (!getAccessToken()) throw new Error("Session ended");
        const caps = parseCapabilities(
          await containerRequest("capabilities", signal),
        );
        if (!current()) return;
        // Inventory is never requested until an exact, valid live grant exists.
        const list = inventory
          ? parseInventory(await containerRequest("", signal))
          : [];
        if (!current()) return;
        if (
          list.some(
            (instance) =>
              !instance.domain.endsWith("." + caps.domain_suffix) ||
              !validSubdomain(
                instance.domain.slice(0, -(caps.domain_suffix.length + 1)),
              ),
          )
        )
          throw new Error("Invalid domain");
        // A post-mutation reload supersedes any older in-flight inventory read.
        if (read !== latestRead.current) return;
        granted.current = true;
        setCapabilities(caps);
        setInstances(list);
        setError("");
      } catch {
        if (current()) {
          clear();
          setError(
            "Administrator access unavailable. No container data is displayed.",
          );
        }
      } finally {
        if (generation === epoch.current)
          refreshing.current = Math.max(0, refreshing.current - 1);
        if (active.current) setLoading(false);
      }
    },
    [clear, inventory],
  );

  useEffect(() => {
    active.current = true;
    controller.current = new AbortController();
    refreshing.current = 0;
    void refresh();
    const timer = window.setInterval(() => {
      if (!getAccessToken()) {
        clear();
        setError("Session ended. Sign in again.");
      } else void refresh();
    }, 5000);
    const focus = () => {
      void refresh();
    };
    window.addEventListener("focus", focus);
    return () => {
      active.current = false;
      clear();
      window.clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [clear, refresh]);

  const run = async <T>(
    path: string,
    method: string,
    data: unknown,
    parse: (value: unknown) => T,
  ): Promise<T | undefined> => {
    if (!getAccessToken()) {
      clear();
      setError("Session ended. Sign in again.");
      return;
    }
    if (!active.current || !granted.current || mutation.current) return;
    mutation.current = true;
    setPending(true);
    setError("");
    const generation = epoch.current;
    const signal = controller.current.signal;
    const current = () => {
      if (!active.current || generation !== epoch.current || signal.aborted)
        return false;
      if (!getAccessToken()) {
        clear();
        setError("Session ended. Sign in again.");
        return false;
      }
      return true;
    };
    try {
      const result = await containerRequest(path, signal, method, data);
      if (!current()) return;
      let parsed: T;
      try {
        parsed = parse(result);
      } catch {
        clear();
        setError("Invalid server response. Access cleared; retry safely.");
        return;
      }
      return parsed;
    } catch (failure) {
      if (current()) {
        if (authorizationFailure(failure)) clear();
        setError(
          authorizationFailure(failure)
            ? "Administrator access revoked. No container data is displayed."
            : safeError(failure),
        );
      }
    } finally {
      if (current()) {
        mutation.current = false;
        setPending(false);
      }
    }
  };
  return { capabilities, instances, error, loading, pending, refresh, run };
}
