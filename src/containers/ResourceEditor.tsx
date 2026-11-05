import { useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
} from "@mui/material";
import type { Capabilities, Instance } from "./types";
import { editableResources, validResources } from "./types";
import GpuSelector from "./GpuSelector";

export default function ResourceEditor({
  opening,
  current,
  caps,
  pending,
  action,
  close,
}: {
  opening: Instance;
  current: Instance;
  caps: Capabilities;
  pending: boolean;
  action: (path: string, method?: string, data?: unknown) => Promise<boolean>;
  close: () => void;
}) {
  // Snapshot belongs to the opening revision, never to subsequent polling reads.
  const [cpu, setCpu] = useState(opening.cpu);
  const [memory, setMemory] = useState(opening.memory_gb);
  const [gpuIds, setGpuIds] = useState(opening.gpu_ids ?? []);
  const [consent, setConsent] = useState(false);
  const [failed, setFailed] = useState(false);
  const gpuChanged =
    gpuIds.length !== opening.gpu_ids?.length ||
    gpuIds.some((id) => !opening.gpu_ids?.includes(id));
  const restart =
    current.status === "running" && (memory < opening.memory_gb || gpuChanged);
  const unknown = gpuIds.some((id) => !caps.gpus?.some((gpu) => gpu.id === id));
  const valid =
    editableResources(current, caps) &&
    validResources(cpu, memory, caps) &&
    !unknown &&
    (!restart || consent) &&
    !failed;
  return (
    <Dialog
      open
      onClose={() => {
        if (!pending) close();
      }}
      fullWidth
    >
      <DialogTitle>Edit resources: {opening.name}</DialogTitle>
      <DialogContent>
        <Stack gap={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            Opening revision: {opening.resource_version}. Polling does not
            rewrite this draft. CPU and RAM increases do not require a restart.
          </Alert>
          <TextField
            label="CPU cores"
            type="number"
            value={cpu}
            disabled={pending}
            onChange={(e) => setCpu(Number(e.target.value))}
            slotProps={{
              htmlInput: { min: 1, step: 1, max: caps.max_cpu ?? undefined },
            }}
          />
          <TextField
            label="Memory (GB decimal)"
            type="number"
            value={memory}
            disabled={pending}
            onChange={(e) => setMemory(Number(e.target.value))}
            helperText="Positive RAM, at most three decimal places; backend limits apply."
            slotProps={{
              htmlInput: {
                min: 0.001,
                step: "any",
                max: caps.max_memory_gb ?? undefined,
              },
            }}
          />
          <GpuSelector
            caps={caps}
            selected={gpuIds}
            onChange={setGpuIds}
            disabled={pending}
          />
          {restart && (
            <>
              <Alert severity="warning">
                Reducing running memory or changing GPUs requires a restart.
                Connections close; data, full root filesystem and /home are
                preserved.
              </Alert>
              <FormControlLabel
                label="I explicitly consent to restart and close connections"
                control={
                  <Checkbox
                    checked={consent}
                    disabled={pending}
                    onChange={(_, checked) => setConsent(checked)}
                  />
                }
              />
            </>
          )}
          {unknown && (
            <Alert severity="warning">
              A selected GPU is unavailable. Explicitly remove it to continue;
              selections are never silently dropped.
            </Alert>
          )}
          {failed && (
            <Alert severity="warning">
              Update not confirmed. Close, refresh inventory and reopen to use a
              fresh revision.
            </Alert>
          )}
          {!validResources(cpu, memory, caps) && (
            <Alert severity="warning">
              Enter a positive integer CPU and finite positive RAM with at most
              three decimal places, within the advertised limits.
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={pending} onClick={close}>
          Cancel
        </Button>
        <Button
          disabled={pending || !valid}
          onClick={async () => {
            if (
              await action(`${opening.id}/resources`, "POST", {
                cpu,
                memory_gb: memory,
                gpu_ids: gpuIds,
                expected_version: opening.resource_version,
                allow_restart: restart && consent,
              })
            )
              close();
            else setFailed(true);
          }}
        >
          Save resources
        </Button>
      </DialogActions>
    </Dialog>
  );
}
