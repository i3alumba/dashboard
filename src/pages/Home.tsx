import React from "react";
import { Box, Typography, Button } from "@mui/material";
import { clearTokens } from "../utils/cookies";

const Home: React.FC = () => {
  const handleLogout = () => {
    clearTokens();
    window.location.reload();
  };

  return (
    <Box p={4}>
      <Typography variant="h3" gutterBottom>
        Welcome!
      </Typography>
      <Button variant="contained" onClick={handleLogout}>
        Logout
      </Button>
    </Box>
  );
};

export default Home;
