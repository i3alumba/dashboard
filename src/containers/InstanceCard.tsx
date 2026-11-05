import { useRef, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ResourceEditor from "./ResourceEditor";
import { editableResources } from "./types";
import type { Capabilities, Instance, PortCheck, PortSpec } from "./types";
import { validPassword, validPort } from "./types";
import PortEditor from "./PortEditor";

interface Props {
  instance: Instance;
  capabilities: Capabilities;
  pending: boolean;
  externalIngressReady: boolean;
  action: (path: string, method?: string, data?: unknown) => Promise<boolean>;
  check: (port: PortSpec) => Promise<PortCheck | undefined>;
  restart: (id: string) => Promise<void>;
}
export default function InstanceCard({
  instance: item,
  capabilities,
  pending,
  externalIngressReady,
  action,
  check,
  restart,
}: Props) {
  const [opening, setOpening] = useState<Instance | null>(null);
  const [passwordValid, setPasswordValid] = useState(false);
  const password = useRef<HTMLInputElement>(null);
  const [ports, setPorts] = useState<PortSpec[]>([
    { protocol: "tcp", public_port: 0, target_port: 0 },
  ]);
  const [copyStatus, setCopyStatus] = useState("");
  const [restartOpen, setRestartOpen] = useState(false);
  const ssh = item.ports.find(
    (port) =>
      port.protocol === "tcp" &&
      port.target_port === 22 &&
      port.status === "active",
  );
  const command = ssh ? `ssh root@${item.domain} -p ${ssh.public_port}` : "";
  return (
    <Paper
      component="article"
      aria-label={`Container ${item.name}`}
      sx={{ p: { xs: 2, sm: 3 }, overflowWrap: "anywhere" }}
    >
      <Stack gap={2}>
        <Typography variant="h6" component="h2">
          {item.name}
        </Typography>
        <Typography>ID: {item.id}</Typography>
        <Typography>
          State: {item.status} · {item.cpu} CPU · {item.memory_gb} GB decimal
          RAM · {item.domain} · {item.node}
        </Typography>
        {item.status === "error" && (
          <Alert severity="warning">
            Container operation failed. Retry or contact the operator.
          </Alert>
        )}
        {command && (
          <>
            <Typography component="code">{command}</Typography>
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(command);
                  setCopyStatus("SSH command copied");
                } catch {
                  setCopyStatus(
                    "Copy unavailable; select the command manually",
                  );
                }
              }}
            >
              Copy SSH command
            </Button>
            <Typography role="status">{copyStatus}</Typography>
          </>
        )}
        <Button
          disabled={pending || !editableResources(item, capabilities)}
          onClick={() => setOpening(item)}
        >
          Edit resources
        </Button>
        {opening && (
          <ResourceEditor
            opening={opening}
            current={item}
            caps={capabilities}
            pending={pending}
            action={action}
            close={() => setOpening(null)}
          />
        )}
        <Typography>GPUs: {item.gpu_ids?.join(", ") || "None"}</Typography>
        <Stack direction="row" gap={1}>
          <Button
            disabled={
              pending || item.status === "running" || item.status === "creating"
            }
            onClick={() => {
              void action(`${item.id}/start`);
            }}
          >
            Start
          </Button>
          <Button
            disabled={
              pending || item.status === "stopped" || item.status === "creating"
            }
            onClick={() => {
              void action(`${item.id}/stop`);
            }}
          >
            Stop
          </Button>
          <Button
            disabled={pending || item.status !== "running"}
            onClick={() => setRestartOpen(true)}
          >
            Restart
          </Button>
        </Stack>
        <Dialog
          open={restartOpen}
          onClose={() => setRestartOpen(false)}
          aria-labelledby={`restart-${item.id}`}
        >
          <DialogTitle
            id={`restart-${item.id}`}
            sx={{ overflowWrap: "anywhere" }}
          >
            Restart {item.name}?
          </DialogTitle>
          <DialogContent>
            <DialogContentText>
              The container will stop and start. Existing connections will
              close; files and settings are preserved. If interrupted, it may
              remain stopped. Refresh inventory before retrying an unconfirmed
              result.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRestartOpen(false)}>Cancel</Button>
            <Button
              disabled={!restartOpen || pending || item.status !== "running"}
              onClick={() => {
                if (!restartOpen || pending || item.status !== "running")
                  return;
                setRestartOpen(false);
                void restart(item.id);
              }}
            >
              Restart
            </Button>
          </DialogActions>
        </Dialog>
        <Typography variant="subtitle1">Existing ports</Typography>
        {item.ports.length === 0 && (
          <Typography>No published or reserved ports.</Typography>
        )}
        {item.ports.map((port) => (
          <Stack
            key={port.id}
            sx={{
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 2,
              p: 2,
            }}
            gap={1}
          >
            <Typography>
              {port.protocol.toUpperCase()} public {port.public_port} → guest{" "}
              {port.target_port}
            </Typography>
            <Typography>
              Allocation: {port.status === "active" ? "published" : port.status}
              . Service: {port.reachability.replaceAll("_", " ")}.
            </Typography>
            <Button
              disabled={pending}
              onClick={() => {
                void action(`${item.id}/ports/${port.id}`, "DELETE");
              }}
            >
              Remove port {port.public_port}/{port.protocol}
            </Button>
          </Stack>
        ))}
        <Typography variant="subtitle1">
          Add port to this container (no recreation)
        </Typography>
        <PortEditor
          ports={ports}
          onChange={setPorts}
          disabled={pending || !externalIngressReady}
          check={check}
          single
        />
        <Button
          disabled={pending || !externalIngressReady || !validPort(ports[0])}
          onClick={async () => {
            if (await action(`${item.id}/ports`, "POST", ports[0]))
              setPorts([{ protocol: "tcp", public_port: 0, target_port: 0 }]);
          }}
        >
          Save additional port
        </Button>
        <Stack
          component="form"
          autoComplete="off"
          gap={1}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!passwordValid || pending || !password.current) return;
            const root_password = password.current.value;
            password.current.value = "";
            setPasswordValid(false);
            await action(`${item.id}/password`, "POST", { root_password });
          }}
        >
          <TextField
            label="New root password"
            type="password"
            inputRef={password}
            autoComplete="new-password"
            disabled={pending}
            helperText="16–256 characters; no CR, LF, NUL or colon. Never returned or retained."
            onChange={(e) => setPasswordValid(validPassword(e.target.value))}
          />
          <Button type="submit" disabled={pending || !passwordValid}>
            Reset root password
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
