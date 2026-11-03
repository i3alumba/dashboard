import { useState, type FormEvent } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { UserRow } from "./types";

export interface UserProfile {
  email: string;
  first_name: string;
  last_name: string;
}

export default function EditUserProfile({
  user,
  pending,
  save,
  close,
}: {
  user: UserRow;
  pending: boolean;
  save: (user: UserRow, profile: UserProfile) => Promise<boolean>;
  close: () => void;
}) {
  // Keep the ETag and inputs from opening the dialog; polling must not silently
  // replace an in-progress edit with another administrator's newer version.
  const [profile, setProfile] = useState<UserProfile>({
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
  });
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pending && (await save(user, profile))) close();
  };
  return (
    <Dialog
      open
      onClose={() => {
        if (!pending) close();
      }}
      fullWidth
      maxWidth="sm"
    >
      <Box
        component="form"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <DialogTitle>Edit user profile</DialogTitle>
        <DialogContent>
          <Stack spacing={2} pt={1}>
            <Typography>
              {user.username} · Username and native identities are unchanged.
            </Typography>
            <TextField
              label="Email"
              type="email"
              autoComplete="off"
              value={profile.email}
              disabled={pending}
              slotProps={{ htmlInput: { maxLength: 254 } }}
              onChange={(event) =>
                setProfile({ ...profile, email: event.target.value })
              }
            />
            <TextField
              label="First name"
              autoComplete="off"
              value={profile.first_name}
              disabled={pending}
              slotProps={{ htmlInput: { maxLength: 150 } }}
              onChange={(event) =>
                setProfile({ ...profile, first_name: event.target.value })
              }
            />
            <TextField
              label="Last name"
              autoComplete="off"
              value={profile.last_name}
              disabled={pending}
              slotProps={{ htmlInput: { maxLength: 150 } }}
              onChange={(event) =>
                setProfile({ ...profile, last_name: event.target.value })
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button disabled={pending} type="submit">
            Save profile
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
