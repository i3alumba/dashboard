import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import theme from "./theme";
import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/Login";
import Home from "./pages/Home";

const App: React.FC = () => (
  <ThemeProvider theme={theme}>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<Home />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </ThemeProvider>
);

export default App;
