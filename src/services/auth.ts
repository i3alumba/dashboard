import axios from "axios";
import { clearTokens, getRefreshToken, setTokens } from "../utils/cookies";
import { backendURL } from "./api";

interface SessionInfo {
  authenticated: boolean;
  csrfToken: string;
}

const sessionClient = axios.create({
  baseURL: backendURL,
  withCredentials: true,
});

async function sessionInfo(): Promise<SessionInfo> {
  const { data } = await sessionClient.get<SessionInfo>("session/");
  if (typeof data.csrfToken !== "string") {
    throw new Error("Invalid authentication response");
  }
  return data;
}

function savePair(data: { access: string; refresh: string }) {
  if (typeof data.access !== "string" || typeof data.refresh !== "string") {
    throw new Error("Invalid authentication response");
  }
  setTokens(data.access, data.refresh);
}

export async function login(username: string, password: string) {
  const session = await sessionInfo();
  const response = await sessionClient.post(
    "session/login/",
    { username, password },
    { headers: { "X-CSRFToken": session.csrfToken } },
  );
  savePair(response.data);
  return response;
}

export async function restoreSession(): Promise<boolean> {
  try {
    const session = await sessionInfo();
    if (!session.authenticated) return false;
    const { data } = await sessionClient.post(
      "session/token/",
      {},
      { headers: { "X-CSRFToken": session.csrfToken } },
    );
    savePair(data);
    return true;
  } catch {
    return false;
  }
}

export async function logout() {
  try {
    const session = await sessionInfo();
    // A legacy JWT-only browser may not yet have a central Django session.
    const refresh = session.authenticated ? getRefreshToken() : undefined;
    await sessionClient.post("session/logout/", refresh ? { refresh } : {}, {
      headers: { "X-CSRFToken": session.csrfToken },
    });
  } finally {
    clearTokens();
  }
}

export const validate = (callback: () => void, onError: () => void) => {
  void restoreSession().then((valid) => (valid ? callback() : onError()));
};
