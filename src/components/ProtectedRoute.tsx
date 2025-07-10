import React, { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { validate } from "../services/auth";
import { clearTokens, getAccessToken, getRefreshToken } from "../utils/cookies";
import { Box, CircularProgress } from "@mui/material";

const ProtectedRoute: React.FC = () => {
  const [auth, setAuth] = useState<boolean | null>(null);

  useEffect(() => {
    const accessToken = getAccessToken();
    const refreshToken = getRefreshToken();
    if (accessToken && refreshToken) {
      setAuth(true);
    } else {
      clearTokens();
      validate(
        () => setAuth(true),
        () => setAuth(false),
      );
    }
  }, []);

  return (
    <>
      {auth == null && (
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "100vh",
            width: "100vw",
          }}
        >
          <CircularProgress
            sx={{ width: "10vw !important", height: "10vw !important" }}
          />
        </Box>
      )}
      {auth == true && <Outlet />}
      {auth == false && <Navigate to="/login" replace />}
    </>
  );
};

export default ProtectedRoute;
