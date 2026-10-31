import React, { useEffect, useState } from "react";
import { Box, Typography, Button, CircularProgress } from "@mui/material";
import { logout } from "../services/auth";
import api from "../services/api";

interface Service {
  slug: string;
  url: string;
}

const serviceLabels: Record<string, string> = {
  drive: "Drive",
  matrix: "Matrix",
  gitlab: "GitLab",
  minio: "MinIO",
  jenkins: "Jenkins",
};

const colorPalette: Array<
  "primary" | "secondary" | "error" | "warning" | "info" | "success"
> = ["primary", "secondary", "error", "warning", "info", "success"];

const Home: React.FC = () => {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchServices = async () => {
      try {
        const { data } = await api.get<{
          services: Record<string, { enabled: boolean; url: string }>;
        }>("/access/");
        setServices(
          Object.entries(data.services)
            .filter(
              ([slug, service]) =>
                slug in serviceLabels && service.enabled === true,
            )
            .map(([slug, service]) => ({ slug, url: service.url })),
        );
      } catch (err) {
        if (err instanceof Error) {
          setError(err.name);
        } else {
          setError("Failed to load services");
        }
      } finally {
        setLoading(false);
      }
    };

    void fetchServices();
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
      window.location.assign("/login");
    } catch {
      setError("Could not end the central session. Please retry logout.");
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" flex={1}>
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
        Your Services
      </Typography>
      <Box display="flex" flexWrap="wrap" gap={2} mb={4}>
        {services.map((service, idx) => {
          const color = colorPalette[idx % colorPalette.length];
          return (
            <Button
              key={service.slug}
              variant="contained"
              color={color}
              href={service.url}
            >
              {serviceLabels[service.slug]}
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
