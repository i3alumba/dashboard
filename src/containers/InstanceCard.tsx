import { useRef, useState } from "react";
import {
  Alert,
  Button,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { Instance, PortCheck, PortSpec } from "./types";
import { validPassword, validPort } from "./types";
import PortEditor from "./PortEditor";

interface Props {
  instance: Instance;
  pending: boolean;
  externalIngressReady: boolean;
  action: (path: string, method?: string, data?: unknown) => Promise<boolean>;
  check: (port: PortSpec) => Promise<PortCheck | undefined>;
}
export default function InstanceCard({
  instance: item,
  pending,
  externalIngressReady,
  action,
  check,
}: Props) {
  const [passwordValid, setPasswordValid] = useState(false);
  const password = useRef<HTMLInputElement>(null);
  const [ports, setPorts] = useState<PortSpec[]>([
    { protocol: "tcp", public_port: 0, target_port: 0 },
  ]);
  const [copyStatus, setCopyStatus] = useState("");
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
        </Stack>
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
