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
  const password = useRef<HTMLInputElement>(null);
  const duplicate = ports.some((port, i) =>
    ports.some(
      (other, j) =>
        j < i &&
        port.protocol === other.protocol &&
        port.public_port === other.public_port,
    ),
  );
  const valid =
    /^[a-z][a-z0-9-]{0,31}$/.test(name) &&
    validSubdomain(subdomain) &&
    Number.isInteger(cpu) &&
    cpu >= 1 &&
    cpu <= caps.max_cpu &&
    memory > 0 &&
    memory <= caps.max_memory_gb &&
    ports.every(validPort) &&
    !duplicate &&
    (caps.external_ingress_ready || ports.length === 0) &&
    passwordValid;
  return (
    <Paper
      component="form"
      autoComplete="off"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid || pending || !password.current) return;
        const root_password = password.current.value;
        password.current.value = "";
        setPasswordValid(false);
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
          disabled={pending}
          autoComplete="new-password"
          helperText="16–256 characters; no CR, LF, NUL or colon. Write-only; cleared immediately on submit."
          onChange={(e) => setPasswordValid(validPassword(e.target.value))}
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
        <Button type="submit" variant="contained" disabled={pending || !valid}>
          Create container
        </Button>
      </Stack>
    </Paper>
  );
}
