import { useRef, useState } from "react";
import { Button, Paper, Stack, TextField, Typography } from "@mui/material";
import type {
  Capabilities,
  CreateInstance,
  Instance,
  PortCheck,
  PortSpec,
} from "./types";
import { initialPort, validPassword, validPort, validSubdomain } from "./types";
import PortEditor from "./PortEditor";

interface Props {
  capabilities: Capabilities;
  instances: Instance[];
  pending: boolean;
  create: (payload: CreateInstance) => Promise<boolean>;
  check: (port: PortSpec) => Promise<PortCheck | undefined>;
}
export default function CreateForm({
  capabilities: caps,
  instances,
  pending,
  create,
  check,
}: Props) {
  const [name, setName] = useState("");
  const [subdomain, setSubdomain] = useState("mc");
  const domain = `${subdomain}.${caps.domain_suffix}`;
  const [cpu, setCpu] = useState(1);
  const [memory, setMemory] = useState(1);
  const [ports, setPorts] = useState<PortSpec[]>([initialPort()]);
  const [passwordValid, setPasswordValid] = useState(false);
  const [passwordPresent, setPasswordPresent] = useState(false);
  const password = useRef<HTMLInputElement>(null);
  const syncPasswordValidity = (value: string) => {
    // Keep only validation booleans in React state, never the secret itself.
    setPasswordValid(validPassword(value));
    setPasswordPresent(value.length > 0);
  };
  const duplicate = ports.some((port, i) =>
    ports.some(
      (other, j) =>
        j < i &&
        port.protocol === other.protocol &&
        port.public_port === other.public_port,
    ),
  );
  const nameValid = /^[a-z][a-z0-9-]{0,31}$/.test(name);
  const validationErrors = [
    !nameValid &&
      "Name must start with a lowercase letter and contain only lowercase letters, digits or hyphens (max 32).",
    !validSubdomain(subdomain) &&
      "Subdomain must be one lowercase DNS label, without dots or leading/trailing hyphens.",
    !(Number.isInteger(cpu) && cpu >= 1 && cpu <= caps.max_cpu) &&
      `CPU cores must be an integer from 1 to ${caps.max_cpu}.`,
    !(memory > 0 && memory <= caps.max_memory_gb) &&
      `Memory must be greater than zero and at most ${caps.max_memory_gb} GB.`,
    !ports.every(validPort) &&
      "Each port needs a public port from 3000 to 50000 and a guest target from 1 to 65535.",
    duplicate && "Remove duplicate public port/protocol entries.",
    !(caps.external_ingress_ready || ports.length === 0) &&
      "Public ingress is not configured; remove public ports or contact the operator.",
    !passwordValid &&
      "Root password must contain 16–256 characters without CR, LF, NUL or colon.",
  ].filter(Boolean);
  const valid = validationErrors.length === 0;
  return (
    <Paper
      component="form"
      autoComplete="off"
      onInputCapture={() => {
        if (password.current) syncPasswordValidity(password.current.value);
      }}
      onFocusCapture={() => {
        if (password.current) syncPasswordValidity(password.current.value);
      }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid || pending || !password.current) return;
        const root_password = password.current.value;
        // Recheck the DOM value: autofill can change an uncontrolled input.
        if (!validPassword(root_password)) {
          syncPasswordValidity(root_password);
          return;
        }
        password.current.value = "";
        syncPasswordValidity("");
        if (
          await create({
            name,
            domain,
            cpu,
            memory_gb: memory,
            root_password,
            ports,
          })
        ) {
          setName("");
          setCpu(1);
          setMemory(1);
          setPorts([initialPort()]);
        }
      }}
      sx={{ p: { xs: 2, sm: 3 } }}
    >
      <Stack gap={2}>
        <Typography variant="h6" component="h2">
          Create Ubuntu container
        </Typography>
        <TextField
          label="Name"
          error={name.length > 0 && !nameValid}
          value={name}
          disabled={pending}
          helperText="Lowercase letter first; lowercase letters, digits, hyphens; max 32."
          onChange={(e) => setName(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 32 } }}
        />
        <TextField
          label="Subdomain"
          value={subdomain}
          disabled={pending}
          onChange={(e) => setSubdomain(e.target.value)}
          helperText={`Address: ${domain}. One lowercase DNS label, max 63 characters; no dots or leading/trailing hyphen.`}
          slotProps={{ htmlInput: { maxLength: 63 } }}
        />
        <TextField
          label="CPU cores"
          type="number"
          value={cpu}
          disabled={pending}
          slotProps={{ htmlInput: { min: 1, max: caps.max_cpu, step: 1 } }}
          onChange={(e) => setCpu(Number(e.target.value))}
        />
        <TextField
          label="Memory (GB decimal)"
          type="number"
          value={memory}
          disabled={pending}
          helperText="1 GB = 1,000,000,000 bytes; maximum 16 GB."
          slotProps={{
            htmlInput: { min: 0.001, max: caps.max_memory_gb, step: "any" },
          }}
          onChange={(e) => setMemory(Number(e.target.value))}
        />
        <TextField
          label="Initial root password"
          type="password"
          inputRef={password}
          slotProps={{ inputLabel: { shrink: passwordPresent || undefined } }}
          disabled={pending}
          autoComplete="new-password"
          error={passwordPresent && !passwordValid}
          helperText="16–256 characters; no CR, LF, NUL or colon. Write-only; cleared immediately on submit."
          onChange={(e) => syncPasswordValidity(e.target.value)}
          onInput={() => {
            if (password.current) syncPasswordValidity(password.current.value);
          }}
          onBlur={() => {
            if (password.current) syncPasswordValidity(password.current.value);
          }}
        />
        <Typography variant="body2">
          Forwarded public range: 3000–50000, excluding infrastructure and
          occupied ports. Initial Ubuntu SSH suggestion: TCP public 3001 → guest
          22; check availability before use.{" "}
          {instances.some((instance) =>
            instance.ports.some(
              (port) => port.protocol === "tcp" && port.public_port === 3001,
            ),
          )
            ? "3001 is already allocated. Choose and check an alternative such as 3002; it is not changed automatically."
            : "For another instance consider 3002 or 3003, and explicitly check availability."}
        </Typography>
        <PortEditor
          ports={ports}
          onChange={setPorts}
          disabled={pending}
          check={check}
        />
        {duplicate && (
          <Typography color="error">
            Duplicate public port/protocol in this draft.
          </Typography>
        )}
        {!valid && (
          <Typography
            role="status"
            aria-label="Create form validation"
            color="text.secondary"
            variant="body2"
          >
            To enable creation: {validationErrors.join(" ")}
          </Typography>
        )}
        <Button type="submit" variant="contained" disabled={pending || !valid}>
          Create container
        </Button>
      </Stack>
    </Paper>
  );
}
