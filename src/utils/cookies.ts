import Cookies from "js-cookie";

export const getAccessToken = (): string | undefined =>
  Cookies.get("access_token");

export const getRefreshToken = (): string | undefined =>
  Cookies.get("refresh_token");

export const setTokens = (access: string, refresh: string) => {
  Cookies.set("access_token", access, { sameSite: "strict" });
  Cookies.set("refresh_token", refresh, { sameSite: "strict" });
};

export const clearTokens = () => {
  Cookies.remove("access_token");
  Cookies.remove("refresh_token");
};
