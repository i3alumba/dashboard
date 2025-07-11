import axios from "axios";
import { setTokens } from "../utils/cookies";
import api, { backendURL } from "./api";

export const login = (username: string, password: string) =>
  axios.post(backendURL + "token/", { username, password }).then((res) => {
    setTokens(res.data.access, res.data.refresh);
    return res;
  });

export const validate = (callback: () => void, onError: () => void) => {
  api
    .post("token/verify")
    .then(() => callback())
    .catch(() => onError());
};
