import React, { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { validate } from "../services/auth";
import { getAccessToken, getRefreshToken } from "../utils/cookies";
import { CircularProgress } from "@mui/material";

const ProtectedRoute: React.FC = () => {
  const [auth, setAuth] = useState<boolean | null>(null);

  useEffect(() => {
    const accessToken = getAccessToken();
    const refreshToken = getRefreshToken();
    if (accessToken && refreshToken) {
      setAuth(true);
    } else {
      validate(
        () => setAuth(true),
        () => setAuth(false),
      );
    }
  }, []);

  return (
    <>
      {auth == null && <CircularProgress />}
      {auth && <Outlet />}
      {!auth && <Navigate to="/login" replace />}
    </>
  );
};

export default ProtectedRoute;
