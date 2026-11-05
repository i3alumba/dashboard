import {
  Alert,
  Checkbox,
  FormControlLabel,
  Stack,
  Typography,
} from "@mui/material";
import type { Capabilities } from "./types";
import { gpuSupported } from "./types";

export default function GpuSelector({
  caps,
  selected,
  onChange,
  disabled,
}: {
  caps: Capabilities;
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  const supported = gpuSupported(caps);
  const available = caps.gpus ?? [];
  const unknown = selected.filter(
    (id) => !available.some((gpu) => gpu.id === id),
  );
  return (
    <Stack gap={1}>
      <Typography>Shared GPUs</Typography>
      <Alert severity="warning">
        GPUs are shared across containers, without a VRAM quota or exclusive
        reservation. GPU access exposes host drivers.
      </Alert>
      {!supported && (
        <Alert severity="warning">
          Resource editing and GPU selection unavailable. Ask the operator to
          upgrade/enable the backend capability.
        </Alert>
      )}
      {available.map((gpu) => (
        <FormControlLabel
          key={gpu.id}
          label={`${gpu.name} (${gpu.id})`}
          control={
            <Checkbox
              disabled={disabled || !supported}
              checked={selected.includes(gpu.id)}
              onChange={(_, checked) =>
                onChange(
                  checked
                    ? [...selected, gpu.id]
                    : selected.filter((id) => id !== gpu.id),
                )
              }
            />
          }
        />
      ))}
      {unknown.map((id) => (
        <FormControlLabel
          key={id}
          label={`Unavailable GPU ${id}: explicitly uncheck to remove`}
          control={
            <Checkbox
              disabled={disabled || !supported}
              checked
              onChange={() =>
                onChange(selected.filter((value) => value !== id))
              }
            />
          }
        />
      ))}
    </Stack>
  );
}
