import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import {
  AppBar,
  Box,
  CssBaseline,
  Toolbar,
  Typography,
  Link,
  Container,
} from "@mui/material";
import ThemeToggle from "./components/ThemeToggle";
import { theme } from "./ui/sharedTheme";
import { MODE_STORAGE_KEY, createThemeStorageManager } from "./ui/themeStorage";

import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Containers from "./pages/Containers";
import HostingRedirect from "./pages/HostingRedirect";

const hostingOrigin = window.location.hostname === "hosting.i3alumba.ru";
const portalOrigin = window.location.hostname === "main.i3alumba.ru";
const storageManager = createThemeStorageManager("dashboard-color-mode");

const App: React.FC = () => (
  <ThemeProvider
    theme={theme}
    defaultMode="system"
    modeStorageKey={MODE_STORAGE_KEY}
    storageManager={storageManager}
    disableTransitionOnChange
  >
    <CssBaseline enableColorScheme />
    <Box sx={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <AppBar position="static">
        <Container maxWidth={false} sx={{ maxWidth: 1280 }}>
          <Toolbar disableGutters sx={{ gap: { xs: 1.5, sm: 3 } }}>
            <Link
              href="https://main.i3alumba.ru/"
              color="inherit"
              underline="none"
              sx={{ fontWeight: 800, fontSize: "1.125rem" }}
            >
              i3alumba
            </Link>
            <Typography component="h1" variant="h6" sx={{ flexGrow: 1 }}>
              {hostingOrigin ? "Ubuntu Hosting" : "Dashboard"}
            </Typography>
            <ThemeToggle />
          </Toolbar>
        </Container>
      </AppBar>
      <Box
        component="main"
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          width: "100%",
          maxWidth: 1280,
          mx: "auto",
          px: { xs: 2, sm: 3 },
          py: { xs: 3, sm: 5 },
        }}
      >
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<ProtectedRoute />}>
              <Route
                path="/"
                element={hostingOrigin ? <Containers /> : <Home />}
              />
              <Route
                path="/containers"
                element={
                  hostingOrigin ? (
                    <Navigate to="/" replace />
                  ) : portalOrigin ? (
                    <HostingRedirect />
                  ) : (
                    <Containers />
                  )
                }
              />
            </Route>
          </Routes>
        </BrowserRouter>
      </Box>
    </Box>
  </ThemeProvider>
);

export default App;
