import {
  Alert,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import { Link } from "react-router-dom";
import CreateForm from "../containers/CreateForm";
import InstanceCard from "../containers/InstanceCard";
import { parseCheck, parseInstance } from "../containers/api";
import { useContainers } from "../containers/useContainers";
import type { PortSpec } from "../containers/types";

export default function Containers() {
  const panel = useContainers(true);
  const check = (port: PortSpec) =>
    panel.run(
      "ports/check",
      "POST",
      { protocol: port.protocol, public_port: port.public_port },
      parseCheck,
    );
  const action = async (path: string, method = "POST", data?: unknown) => {
    const result = await panel.run(
      path,
      method,
      data,
      path.endsWith("/password")
        ? (value) => {
            if (
              !value ||
              typeof value !== "object" ||
              !("changed" in value) ||
              value.changed !== true
            )
              throw new Error("Invalid response");
            return true;
          }
        : (value) => {
            parseInstance(value);
            return true;
          },
    );
    if (result) await panel.refresh(true);
    return result === true;
  };
  return (
    <Stack gap={3} sx={{ width: "100%", minWidth: 0 }}>
      <Button component={Link} to="/" sx={{ alignSelf: "start" }}>
        Back to Dashboard
      </Button>
      <Typography variant="h5" component="h1">
        Ubuntu containers
      </Typography>
      {panel.loading && (
        <CircularProgress aria-label="Checking administrator access" />
      )}
      {panel.error && (
        <Alert severity="warning" role="alert">
          {panel.error}
        </Alert>
      )}
      <Button
        disabled={panel.pending || panel.loading}
        onClick={() => {
          void panel.refresh();
        }}
      >
        Retry / refresh access and inventory
      </Button>
      {panel.capabilities && (
        <>
          <Alert severity="info">
            {panel.capabilities.image} on gamma SSD. Full OS root filesystem and
            separate /home are persistent across stop/start, including packages
            and /etc. No disk quota. Warning: the shared SSD can fill up;
            monitor free space and contact the operator before it is full.
            Containers are never deleted here.
          </Alert>
          {!panel.capabilities.external_ingress_ready && (
            <Alert severity="warning">
              External router/ingress is not configured. Public port creation is
              blocked even if the host port is free. The operator must configure
              and verify upstream forwarding first.
            </Alert>
          )}
          <CreateForm
            capabilities={panel.capabilities}
            instances={panel.instances}
            pending={panel.pending}
            check={check}
            create={(payload) => action("", "POST", payload)}
          />
          <Typography variant="h6" component="h2">
            Container inventory
          </Typography>
          {!panel.instances.length && <Typography>No containers.</Typography>}
          {panel.instances.map((instance) => (
            <InstanceCard
              key={instance.id}
              instance={instance}
              pending={panel.pending}
              externalIngressReady={
                panel.capabilities?.external_ingress_ready === true
              }
              action={action}
              check={check}
            />
          ))}
        </>
      )}
    </Stack>
  );
}
