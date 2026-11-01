import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { PortCheck, PortSpec } from "./types";
import { validPort } from "./types";

interface RowProps {
  port: PortSpec;
  onChange: (port: PortSpec) => void;
  disabled: boolean;
  check: (port: PortSpec) => Promise<PortCheck | undefined>;
}
function PortRow({ port, onChange, disabled, check }: RowProps) {
  const [inspection, setInspection] = useState<{
    key: string;
    result?: PortCheck;
  }>();
  const key = JSON.stringify(port);
  const result = inspection?.key === key ? inspection.result : undefined;
  return (
    <Stack gap={1}>
      <Box
        display="grid"
        gridTemplateColumns={{ xs: "1fr", sm: "1fr 1fr 1fr" }}
        gap={1}
      >
        <TextField
          select
          label="Protocol"
          value={port.protocol}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...port,
              protocol: e.target.value as PortSpec["protocol"],
            })
          }
        >
          <MenuItem value="tcp">TCP</MenuItem>
          <MenuItem value="udp">UDP</MenuItem>
        </TextField>
        <TextField
          label="Public port"
          type="number"
          value={port.public_port}
          disabled={disabled}
          slotProps={{ htmlInput: { min: 3000, max: 50000, step: 1 } }}
          onChange={(e) =>
            onChange({ ...port, public_port: Number(e.target.value) })
          }
        />
        <TextField
          label="Guest target port"
          type="number"
          value={port.target_port}
          disabled={disabled}
          slotProps={{ htmlInput: { min: 1, max: 65535, step: 1 } }}
          onChange={(e) =>
            onChange({ ...port, target_port: Number(e.target.value) })
          }
        />
      </Box>
      <Button
        disabled={disabled || !validPort(port)}
        onClick={async () => {
          setInspection(undefined);
          const result = await check(port);
          setInspection({ key, result });
        }}
      >
        Check availability
      </Button>
      {result && (
        <Alert severity={result.available ? "success" : "warning"}>
          {result.available
            ? "Free now (advisory, not reserved)"
            : Object.values(result.checks).includes("conflict")
              ? "Port conflict: not available"
              : "Inspection unknown: do not assume free"}
          <Typography variant="body2">
            Alpha: {result.checks.alpha}; Gamma: {result.checks.gamma};
            Registry: {result.checks.registry}. Service reachability: unknown.
          </Typography>
        </Alert>
      )}
    </Stack>
  );
}
interface Props {
  ports: PortSpec[];
  onChange: (ports: PortSpec[]) => void;
  disabled: boolean;
  check: RowProps["check"];
  single?: boolean;
}
export default function PortEditor({
  ports,
  onChange,
  disabled,
  check,
  single = false,
}: Props) {
  return (
    <Stack gap={2}>
      <Typography variant="body2">
        Public ports: 3000–50000, excluding reserved infrastructure/NodePorts.
        Public IP + protocol + port is globally exclusive, not domain-isolated.
        Checks are advisory only; every save rechecks and reserves atomically on
        the server. A free port does not mean a service is listening; UDP cannot
        prove reachability.
      </Typography>
      {ports.map((port, index) => (
        <Stack
          key={index}
          gap={1}
          sx={{
            border: "1px solid",
            borderColor: "divider",
            p: 2,
            borderRadius: 2,
          }}
        >
          <PortRow
            port={port}
            disabled={disabled}
            check={check}
            onChange={(updated) =>
              onChange(ports.map((old, i) => (i === index ? updated : old)))
            }
          />
          {!single && (
            <Button
              disabled={disabled}
              onClick={() => onChange(ports.filter((_, i) => i !== index))}
            >
              Remove draft port {index + 1}
            </Button>
          )}
        </Stack>
      ))}
      {!single && (
        <Button
          disabled={disabled}
          onClick={() =>
            onChange([
              ...ports,
              { protocol: "tcp", public_port: 0, target_port: 0 },
            ])
          }
        >
          Add optional port
        </Button>
      )}
    </Stack>
  );
}
