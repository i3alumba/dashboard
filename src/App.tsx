import React from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import {
  AppBar,
  Box,
  CssBaseline,
  Toolbar,
  Typography,
  Link,
  Container,
  CircularProgress,
} from "@mui/material";
import ThemeToggle from "./components/ThemeToggle";
import { theme } from "./ui/sharedTheme";
import { MODE_STORAGE_KEY, createThemeStorageManager } from "./ui/themeStorage";

import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/Login";
const Vllm = React.lazy(() => import("./pages/Vllm"));
import Home from "./pages/Home";
import Containers from "./pages/Containers";
import HostingRedirect from "./pages/HostingRedirect";

const Users = React.lazy(() => import("./pages/Users"));
const usersOrigin = window.location.hostname === "users.i3alumba.ru";
const usersPage = (
  <React.Suspense
    fallback={<CircularProgress aria-label="Loading user administration" />}
  >
    <Users />
  </React.Suspense>
);

const hostingOrigin = window.location.hostname === "hosting.i3alumba.ru";
const portalOrigin = window.location.hostname === "main.i3alumba.ru";
const storageManager = createThemeStorageManager("dashboard-color-mode");

function Shell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const chat =
    window.location.hostname === "vllm.i3alumba.ru" &&
    location.pathname === "/";
  return (
    <Box
      className={chat ? "chat-shell" : undefined}
      sx={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        ...(chat ? { height: "100dvh", overflow: "hidden" } : {}),
      }}
    >
      {!chat && (
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
                {usersOrigin
                  ? "User administration"
                  : hostingOrigin
                    ? "Ubuntu Hosting"
                    : "Dashboard"}
              </Typography>
              <ThemeToggle />
            </Toolbar>
          </Container>
        </AppBar>
      )}
      <Box
        component="main"
        sx={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          width: "100%",
          ...(chat
            ? {}
            : {
                maxWidth: 1280,
                mx: "auto",
                px: { xs: 2, sm: 3 },
                py: { xs: 3, sm: 5 },
              }),
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
const App: React.FC = () => (
  <ThemeProvider
    theme={theme}
    defaultMode="system"
    modeStorageKey={MODE_STORAGE_KEY}
    storageManager={storageManager}
    disableTransitionOnChange
  >
    <CssBaseline enableColorScheme />
    <BrowserRouter>
      <Shell>
        <React.Suspense
          fallback={<CircularProgress aria-label="Loading chat" />}
        >
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<ProtectedRoute />}>
              <Route
                path="/"
                element={
                  window.location.hostname === "vllm.i3alumba.ru" ? (
                    <Vllm />
                  ) : usersOrigin ? (
                    usersPage
                  ) : hostingOrigin ? (
                    <Containers />
                  ) : (
                    <Home />
                  )
                }
              />
              <Route
                path="/containers"
                element={
                  hostingOrigin || usersOrigin ? (
                    <Navigate to="/" replace />
                  ) : portalOrigin ? (
                    <HostingRedirect />
                  ) : (
                    <Containers />
                  )
                }
              />
              <Route
                path="/users"
                element={
                  usersOrigin ? (
                    <Navigate to="/" replace />
                  ) : portalOrigin || hostingOrigin ? (
                    <Navigate to="/" replace />
                  ) : (
                    usersPage
                  )
                }
              />
            </Route>
          </Routes>
        </React.Suspense>
      </Shell>
    </BrowserRouter>
  </ThemeProvider>
);

export default App;
