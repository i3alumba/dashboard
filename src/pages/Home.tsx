import React, { useEffect, useState } from "react";
import { Box, Typography, Button, CircularProgress } from "@mui/material";
import { clearTokens } from "../utils/cookies";
import api from "../services/api";

interface Group {
  id: number;
  name: string;
}

const colorPalette: Array<
  "primary" | "secondary" | "error" | "warning" | "info" | "success"
> = ["primary", "secondary", "error", "warning", "info", "success"];

const Home: React.FC = () => {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchGroups = async () => {
      try {
        const response = await api.get("/user/");
        const groups = response.data[0].groups;
        setGroups(groups);
      } catch (err) {
        if (err instanceof Error) {
          setError(err.name);
        } else {
          setError("Failed to load groups");
        }
      } finally {
        setLoading(false);
      }
    };

    fetchGroups();
  }, []);

  const handleLogout = () => {
    clearTokens();
    window.location.reload();
  };

  if (loading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        height="100vh"
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box p={4}>
        <Typography variant="h6" color="error">
          {error}
        </Typography>
        <Button variant="contained" onClick={handleLogout} sx={{ mt: 2 }}>
          Logout
        </Button>
      </Box>
    );
  }

  return (
    <Box p={4} display="flex" flexDirection="column" alignItems="start" gap={2}>
      <Typography variant="h3" gutterBottom>
        Your Groups
      </Typography>
      <Box display="flex" flexWrap="wrap" gap={2} mb={4}>
        {groups.map((group, idx) => {
          const color = colorPalette[idx % colorPalette.length];
          return (
            <Button
              key={group.id}
              variant="contained"
              color={color}
              href={"http://" + group.name.toLowerCase() + ".i3alumba.ru"}
            >
              {group.name}
            </Button>
          );
        })}
      </Box>
      <Button variant="outlined" onClick={handleLogout}>
        Logout
      </Button>
    </Box>
  );
};

export default Home;
