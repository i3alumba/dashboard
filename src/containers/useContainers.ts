import { useCallback, useEffect, useRef, useState } from "react";
import { getAccessToken } from "../utils/cookies";
import {
  authorizationFailure,
  containerRequest,
  parseCapabilities,
  parseInventory,
  parseInstance,
  safeError,
} from "./api";
import type { Capabilities, Instance } from "./types";
import { validSubdomain } from "./types";

class InvalidMutationResponse extends Error {}

function parsedMutation<T>(value: unknown, parse: (value: unknown) => T): T {
  try {
    return parse(value);
  } catch {
    throw new InvalidMutationResponse();
  }
}

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

  const mutate = async <T>(
    operation: (
      signal: AbortSignal,
      current: () => boolean,
    ) => Promise<T | undefined>,
    failureMessage?: () => string,
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
      return await operation(signal, current);
    } catch (failure) {
      if (current()) {
        if (authorizationFailure(failure)) {
          clear();
          setError(
            "Administrator access revoked. No container data is displayed.",
          );
        } else if (failure instanceof InvalidMutationResponse) {
          clear();
          setError("Invalid server response. Access cleared; retry safely.");
        } else setError(failureMessage?.() ?? safeError(failure));
      }
    } finally {
      if (current()) {
        mutation.current = false;
        setPending(false);
      }
    }
  };
  const run = <T>(
    path: string,
    method: string,
    data: unknown,
    parse: (value: unknown) => T,
  ) =>
    mutate(async (signal, current) => {
      const result = await containerRequest(path, signal, method, data);
      if (current()) return parsedMutation(result, parse);
    });

  // Keep one mutation reservation across both existing power endpoints. Never
  // start after an unknown stop, authority loss or a changed browser session.
  const restart = (id: string) => {
    let stopped = false;
    return mutate(
      async (signal, current) => {
        const token = getAccessToken();
        const response = await containerRequest(`${id}/stop`, signal, "POST");
        if (!current()) return;
        const item = parsedMutation(response, parseInstance);
        if (item.id !== id || item.status !== "stopped")
          throw new InvalidMutationResponse();
        stopped = true;
        if (getAccessToken() !== token) {
          clear();
          setError(
            "Session changed after stopping. Refresh inventory; restart was not continued.",
          );
          return;
        }
        const result = await containerRequest(`${id}/start`, signal, "POST");
        if (!current()) return;
        const started = parsedMutation(result, parseInstance);
        if (started.id !== id || started.status !== "running")
          throw new InvalidMutationResponse();
        return true;
      },
      () =>
        stopped
          ? "Container was stopped, but restart completion is unconfirmed. Refresh inventory before another power action."
          : "Restart was interrupted; stop outcome is unconfirmed. Refresh inventory before another power action.",
    );
  };

  return {
    capabilities,
    instances,
    error,
    loading,
    pending,
    refresh,
    run,
    restart,
  };
}
