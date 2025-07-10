import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { getAccessToken } from "../utils/cookies";

const ProtectedRoute: React.FC = () => {
  return getAccessToken() ? <Outlet /> : <Navigate to="/login" replace />;
};

export default ProtectedRoute;
