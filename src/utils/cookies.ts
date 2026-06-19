import Cookies from "js-cookie";

const cookieOptions: Cookies.CookieAttributes = {
  sameSite: "strict",
  secure: window.location.protocol === "https:",
  ...(window.location.hostname.endsWith("i3alumba.ru")
    ? { domain: ".i3alumba.ru" }
    : {}),
};

export const getAccessToken = (): string | undefined =>
  Cookies.get("access_token");

export const getRefreshToken = (): string | undefined =>
  Cookies.get("refresh_token");

export const setTokens = (access: string, refresh: string) => {
  Cookies.set("access_token", access, cookieOptions);
  Cookies.set("refresh_token", refresh, cookieOptions);
};

export const clearTokens = () => {
  Cookies.remove("access_token", cookieOptions);
  Cookies.remove("refresh_token", cookieOptions);
};
