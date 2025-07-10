import axios from "axios";
import {
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
} from "../utils/cookies";

const backendURL = "http://auth.i3alumba.ru/api/";

const api = axios.create({
  baseURL: backendURL,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  },
  withCredentials: true,
});

// Attach access token to every request
api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401, try refresh
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refresh = getRefreshToken();
      if (refresh) {
        try {
          const { data } = await axios.post(backendURL + "token/refresh/", {
            refresh,
          });
          setTokens(data.access, refresh);
          original.headers.Authorization = `Bearer ${data.access}`;
          return api(original);
        } catch {
          clearTokens();
          window.location.href = "/login";
        }
      } else {
        clearTokens();
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  },
);

export const login = (username: string, password: string) =>
  axios.post(backendURL + "token/", { username, password }).then((res) => {
    setTokens(res.data.access, res.data.refresh);
    return res;
  });

export const validate = (callback: () => void, onError: () => void) => {
  axios
    .get(backendURL + "token/validate")
    .then(() => callback())
    .catch(() => onError());
};

export default api;
