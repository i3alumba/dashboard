import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import {
  serviceLabels,
  type NativeManagement,
  type NativeService,
  type UserRow,
} from "./types";

interface Props {
  user: UserRow;
  service: NativeService;
  management: NativeManagement;
  actorId: number;
  pending: boolean;
  change: (
    user: UserRow,
    service: NativeService,
    snapshot: NativeManagement,
  ) => Promise<boolean>;
}

export default function NativeManagementControl({
  user,
  service,
  management,
  actorId,
  pending,
  change,
}: Props) {
  const [snapshot, setSnapshot] = useState<NativeManagement | null>(null);
  useEffect(() => {
    setSnapshot(null);
  }, [actorId, management.can_manage]);
  if (!management.can_manage) return null;
  const resumeAllowed =
    management.safe_for_manual_changes && management.pause_actor_id === actorId;
  const disabled = pending || (management.paused && !resumeAllowed);
  return (
    <Stack spacing={0.5} sx={{ maxWidth: 190 }}>
      {management.paused && (
        <Typography variant="caption">
          {management.safe_for_manual_changes
            ? "Paused: safe for manual changes only while this pause remains in effect."
            : "Paused: running or unknown operations remain; manual changes are not safe."}
          {management.pause_actor_id !== actorId &&
            " Only the pausing administrator can resume."}
        </Typography>
      )}
      <Button
        size="small"
        disabled={disabled}
        aria-label={`${user.username}: ${service}: ${management.paused ? "resume" : "pause"} native management`}
        onClick={() => setSnapshot({ ...management })}
      >
        {management.paused ? "Resume management" : "Pause management"}
      </Button>
      <Dialog
        open={snapshot !== null}
        onClose={() => {
          if (!pending) setSnapshot(null);
        }}
      >
        <DialogTitle>
          {snapshot?.paused
            ? "Resume native management"
            : "Pause native management"}
        </DialogTitle>
        <DialogContent>
          <Typography>
            {user.username} · {serviceLabels[service]}
          </Typography>
          <Typography>
            Pausing stops new worker claims, not in-flight requests. Manual
            changes require a quiescent pause. Unknown outcomes never expire and
            are not replayed automatically. Only the administrator who paused
            the target may resume it.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={pending} onClick={() => setSnapshot(null)}>
            Cancel
          </Button>
          <Button
            disabled={pending || (snapshot?.paused === true && !resumeAllowed)}
            onClick={() => {
              if (snapshot)
                void change(user, service, snapshot).then((ok) => {
                  if (ok) setSnapshot(null);
                });
            }}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
