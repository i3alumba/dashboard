import axios from "axios";
import {
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
} from "../utils/cookies";

export const backendURL = "https://auth.i3alumba.ru/api/";

const api = axios.create({
  baseURL: backendURL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Attach access token to every request
api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Share one refresh across concurrent requests: rotated refresh tokens are single-use.
let pendingRefresh: Promise<string> | null = null;
function refreshAccessToken(): Promise<string> {
  if (!pendingRefresh) {
    pendingRefresh = (async () => {
      const refresh = getRefreshToken();
      if (!refresh) throw new Error("Refresh token required");
      const { data } = await axios.post(backendURL + "token/refresh/", {
        refresh,
      });
      if (typeof data.access !== "string")
        throw new Error("Invalid token response");
      setTokens(data.access, data.refresh ?? refresh);
      return data.access as string;
    })().finally(() => {
      pendingRefresh = null;
    });
  }
  return pendingRefresh;
}

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    if (err.response?.status === 401 && original && !original._retry) {
      original._retry = true;
      try {
        const access = await refreshAccessToken();
        original.headers.Authorization = `Bearer ${access}`;
        return api(original);
      } catch {
        clearTokens();
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  },
);

export default api;
