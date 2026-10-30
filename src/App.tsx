import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import { AppBar, Box, CssBaseline, Toolbar, Typography } from "@mui/material";
import ThemeToggle from "./components/ThemeToggle";
import theme from "./theme";
import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/Login";
import Home from "./pages/Home";

const App: React.FC = () => (
  <ThemeProvider
    theme={theme}
    defaultMode="system"
    modeStorageKey="dashboard-color-mode"
    disableTransitionOnChange
  >
    <CssBaseline enableColorScheme />
    <Box sx={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <AppBar position="static">
        <Toolbar>
          <Typography component="h1" variant="h6" sx={{ flexGrow: 1 }}>
            Dashboard
          </Typography>
          <ThemeToggle />
        </Toolbar>
      </AppBar>
      <Box
        component="main"
        sx={{ flex: 1, display: "flex", flexDirection: "column" }}
      >
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<Home />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </Box>
    </Box>
  </ThemeProvider>
);

export default App;
