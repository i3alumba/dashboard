import React, { useEffect, useState } from "react";
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  ButtonBase,
} from "@mui/material";
import FolderIcon from "@mui/icons-material/Folder";
import ChatIcon from "@mui/icons-material/Chat";
import CodeIcon from "@mui/icons-material/Code";
import StorageIcon from "@mui/icons-material/Storage";
import BuildIcon from "@mui/icons-material/Build";
import AnalyticsIcon from "@mui/icons-material/Analytics";
import { logout } from "../services/auth";
import api from "../services/api";
import { Link as RouterLink } from "react-router-dom";
import { useContainers } from "../containers/useContainers";

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
  monitor: "Resource Monitor",
};

const serviceIcons: Record<string, typeof FolderIcon> = {
  drive: FolderIcon,
  matrix: ChatIcon,
  gitlab: CodeIcon,
  minio: StorageIcon,
  jenkins: BuildIcon,
  monitor: AnalyticsIcon,
};

const Home: React.FC = () => {
  const containers = useContainers();
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
    <Box
      display="flex"
      flexDirection="column"
      alignItems="start"
      gap={2}
      width="100%"
    >
      <Typography variant="h5" gutterBottom>
        Your Services
      </Typography>
      <Box
        display="grid"
        gridTemplateColumns={{
          xs: "1fr",
          sm: "repeat(2, minmax(0, 1fr))",
          md: "repeat(3, minmax(0, 1fr))",
        }}
        gap={2}
        mb={2}
        width="100%"
      >
        {services.map((service) => {
          const Icon = serviceIcons[service.slug];
          return (
            <ButtonBase
              key={service.slug}
              component="a"
              href={service.url}
              disableRipple
              sx={{
                minHeight: 150,
                p: 3,
                display: "flex",
                flexDirection: "column",
                gap: 2,
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 3,
                bgcolor: "background.paper",
                color: "text.primary",
                transition:
                  "transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease",
                "&:hover, &.Mui-focusVisible": {
                  transform: "translateY(-5px)",
                  borderColor: "primary.main",
                  boxShadow: 3,
                },
                "&.Mui-focusVisible": {
                  outline: "2px solid",
                  outlineColor: "primary.main",
                  outlineOffset: 3,
                },
                "@media (prefers-reduced-motion: reduce)": {
                  transition: "none",
                  "&, &:hover, &.Mui-focusVisible": { transform: "none" },
                },
              }}
            >
              <Icon
                aria-hidden="true"
                sx={{ fontSize: 40, color: "primary.main" }}
              />
              <Typography component="span" variant="h6">
                {serviceLabels[service.slug]}
              </Typography>
            </ButtonBase>
          );
        })}
      </Box>
      {containers.capabilities && (
        <Button component={RouterLink} to="/containers" variant="outlined">
          Manage Ubuntu containers
        </Button>
      )}
      <Button variant="outlined" onClick={handleLogout}>
        Logout
      </Button>
    </Box>
  );
};

export default Home;
