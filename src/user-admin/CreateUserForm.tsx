import { useRef, useState, type FormEvent } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  serviceLabels,
  type Capabilities,
  type CreateUser,
  type MutableService,
} from "./types";

interface Props {
  capabilities: Capabilities;
  pending: boolean;
  create: (user: CreateUser) => Promise<boolean>;
}

export default function CreateUserForm({
  capabilities,
  pending,
  create,
}: Props) {
  const password = useRef<HTMLInputElement>(null);
  const [passwordPresent, setPasswordPresent] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [admin, setAdmin] = useState(false);
  const [services, setServices] = useState<
    Partial<Record<MutableService, boolean>>
  >({});
  const [invalid, setInvalid] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const secret = password.current?.value ?? "";
    if (
      pending ||
      secret.length < 8 ||
      secret.length > 256 ||
      !/^[a-z][a-z0-9_-]{2,31}$/.test(username)
    ) {
      setInvalid(true);
      return;
    }
    // Secret stays in the uncontrolled DOM/one request, never React/storage/logs.
    if (password.current) password.current.value = "";
    setPasswordPresent(false);
    setInvalid(false);
    if (
      await create({
        username,
        email,
        password: secret,
        is_admin: admin,
        services,
      })
    ) {
      setUsername("");
      setEmail("");
      setAdmin(false);
      setServices({});
    }
  };
  return (
    <Box
      component="form"
      onSubmit={(event) => {
        void submit(event);
      }}
      sx={{ p: 3, bgcolor: "background.paper", borderRadius: 3 }}
    >
      <Typography component="h2" variant="h6" mb={2}>
        Create user
      </Typography>
      <Stack spacing={2}>
        <TextField
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onInputCapture={(event) => {
            if (event.target instanceof HTMLInputElement)
              setUsername(event.target.value);
          }}
          required
          disabled={pending}
          helperText="3–32 lowercase letters, digits, underscores or hyphens; starts with a letter."
          slotProps={{
            htmlInput: { pattern: "[a-z][a-z0-9_\\-]{2,31}", maxLength: 32 },
          }}
        />
        <TextField
          label="Email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onInputCapture={(event) => {
            if (event.target instanceof HTMLInputElement)
              setEmail(event.target.value);
          }}
          disabled={pending}
        />
        <TextField
          label="Initial password"
          type="password"
          inputRef={password}
          autoComplete="new-password"
          required
          disabled={pending}
          onInputCapture={() => setPasswordPresent(!!password.current?.value)}
          onFocus={() => setPasswordPresent(!!password.current?.value)}
          onBlur={() => setPasswordPresent(!!password.current?.value)}
          slotProps={{
            htmlInput: { minLength: 8, maxLength: 256 },
            inputLabel: { shrink: passwordPresent || undefined },
          }}
          helperText="8–256 characters; additional Django password checks apply. Cleared on submission; never copied to native services."
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={admin}
              onChange={(e) => setAdmin(e.target.checked)}
              disabled={pending}
            />
          }
          label="is_admin — full access to user administration and managed services (not Jenkins)"
        />
        <Box display="flex" flexWrap="wrap" gap={1}>
          {capabilities.editable_services
            .filter((slug) => slug !== ("jenkins" as string))
            .map((slug) => (
              <FormControlLabel
                key={slug}
                control={
                  <Checkbox
                    checked={admin || services[slug] === true}
                    disabled={pending || admin}
                    onChange={(e) =>
                      setServices((old) => ({
                        ...old,
                        [slug]: e.target.checked,
                      }))
                    }
                  />
                }
                label={serviceLabels[slug]}
              />
            ))}
        </Box>
        {invalid && (
          <Alert severity="warning">
            Check the username and password requirements.
          </Alert>
        )}
        <Button variant="contained" type="submit" disabled={pending}>
          Create user
        </Button>
      </Stack>
    </Box>
  );
}
