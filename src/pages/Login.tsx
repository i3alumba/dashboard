import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  TextField,
  Button,
  Typography,
  Paper,
} from "@mui/material";
import { login, restoreSession } from "../services/auth";

const Login: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void restoreSession().then((valid) => {
      if (!active) return;
      setChecking(false);
      if (valid) navigate("/", { replace: true });
    });
    return () => {
      active = false;
    };
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login(username, password);
      navigate("/", { replace: true });
    } catch {
      setError("Login failed. Check your credentials and try again.");
    }
  };

  return (
    <Box sx={{ flex: 1, display: "grid", placeItems: "center" }}>
      <Paper variant="outlined" sx={{ width: "100%", maxWidth: 420 }}>
        <Box
          component="form"
          onSubmit={handleSubmit}
          display="flex"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          p={{ xs: 3, sm: 4 }}
          gap={2}
        >
          <Typography variant="h5" component="h2">
            Login
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            fullWidth
            autoComplete="username"
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <TextField
            fullWidth
            autoComplete="current-password"
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Button
            fullWidth
            type="submit"
            variant="contained"
            disabled={checking}
          >
            Sign In
          </Button>
        </Box>
      </Paper>
    </Box>
  );
};

export default Login;
