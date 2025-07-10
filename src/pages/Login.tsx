import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, TextField, Button, Typography } from "@mui/material";
import { login } from "../services/auth";

const Login: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(username, password);
      navigate("/", { replace: true });
    } catch {
      alert("Login failed");
    }
  };

  return (
    <Box
      component="form"
      onSubmit={handleSubmit}
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      height="100vh"
      gap={2}
    >
      <Typography variant="h4">Login</Typography>
      <TextField
        label="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
      />
      <TextField
        label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <Button type="submit" variant="contained">
        Sign In
      </Button>
    </Box>
  );
};

export default Login;
