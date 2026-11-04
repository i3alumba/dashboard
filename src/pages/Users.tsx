import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import CreateUserForm from "../user-admin/CreateUserForm";
import EditUserProfile from "../user-admin/EditUserProfile";
import NativeManagementControl from "../user-admin/NativeManagementControl";
import {
  serviceLabels,
  type ServiceSlug,
  type UserRow,
} from "../user-admin/types";
import { useUsers } from "../user-admin/useUsers";
import { nativeProgress } from "../user-admin/nativeProgress";

const slugs = Object.keys(serviceLabels) as ServiceSlug[];

export default function Users() {
  const users = useUsers();
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [confirmation, setConfirmation] = useState<{
    user: UserRow;
    admin?: boolean;
  } | null>(null);
  useEffect(() => {
    if (!users.capabilities) {
      setConfirmation(null);
      setEditing(null);
    }
  }, [users.capabilities]);
  const confirm = async () => {
    if (!confirmation) return;
    const ok =
      confirmation.admin === undefined
        ? await users.activate(confirmation.user)
        : await users.update(confirmation.user, {
            is_admin: confirmation.admin,
          });
    if (ok) setConfirmation(null);
  };
  return (
    <Stack spacing={3}>
      <Link href="https://main.i3alumba.ru/">Back to Dashboard</Link>
      <Typography component="h2" variant="h5">
        User administration
      </Typography>
      {users.loading ? (
        <CircularProgress aria-label="Checking administrator access" />
      ) : !users.capabilities ? (
        <>
          <Alert severity="error">
            {users.error ??
              "Administrator access unavailable. No user data is displayed."}
          </Alert>
          <Button
            onClick={() => {
              void users.refresh();
            }}
          >
            Retry access
          </Button>
        </>
      ) : (
        <>
          {!users.capabilities.native_scheduling_enabled && (
            <Alert
              severity="warning"
              role="note"
              aria-label="Central-only administration"
            >
              Central Auth users and permissions only. External provisioning is
              deferred; no new native work is queued for execution. GitLab and
              Matrix credential issuance is deferred; MinIO automation is
              safety-blocked. Existing native accounts are not adopted or reset.
            </Alert>
          )}
          {(!users.capabilities.native_execution_enabled ||
            !users.capabilities.native_adapters_accepted) && (
            <Alert severity="warning">
              Native adapters are not enabled. Central Auth changes apply
              immediately, but external creation and blocking are not confirmed.
              Check each service status. Jenkins is not managed.
            </Alert>
          )}
          <Alert
            severity="info"
            role="note"
            aria-label="Provisioning-first scope"
          >
            {users.capabilities.native_scheduling_enabled
              ? "Assigning a service requests account setup, not a successful login guarantee. "
              : "Assigning a service changes central permission only; external account setup is deferred. "}
            Removing a grant or deactivating denies new Auth sign-ins; existing
            external sessions and credentials may continue to work. Immediate
            MinIO/Matrix revocation is deferred in the provisioning-only MVP.
          </Alert>
          <Alert severity="info" role="note" aria-label="MinIO blocking scope">
            For newly managed MinIO accounts, blocking denies S3 access only.
            Native STS credentials and Console sessions may still be issued;
            they do not prove data access. Existing unmanaged accounts are not
            adopted.
          </Alert>
          <Alert severity="info" role="note" aria-label="Matrix blocking scope">
            For newly managed Matrix accounts, native lock denies password login
            and sync. Refresh may rotate tokens without restoring access.
            Sessions and keys are preserved rather than permanently revoked.
          </Alert>
          <Alert severity="info" role="note" aria-label="GitLab blocking scope">
            Native GitLab ban is reversible. A cookie may still identify the
            account; identity introspection does not prove private data access.
            Browser/OIDC acceptance is still pending; full credential revocation
            is not claimed.
          </Alert>
          <CreateUserForm
            capabilities={users.capabilities}
            pending={users.pending}
            create={users.create}
          />
          <Box>
            <Typography component="h2" variant="h6" mb={1}>
              Users and service permissions
            </Typography>
            <TableContainer
              sx={{
                bgcolor: "background.paper",
                borderRadius: 3,
                overflowX: "auto",
              }}
            >
              <Table
                aria-label="User service permission matrix"
                sx={{ minWidth: 1100 }}
              >
                <TableHead>
                  <TableRow>
                    <TableCell>User</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>is_admin</TableCell>
                    {slugs.map((slug) => (
                      <TableCell key={slug}>{serviceLabels[slug]}</TableCell>
                    ))}
                    <TableCell>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {users.data.results.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <Typography fontWeight={700}>
                          {user.username}
                        </Typography>
                        <Typography variant="caption">{user.email}</Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={user.is_active ? "Active" : "Inactive"}
                          color={user.is_active ? "success" : "default"}
                        />
                      </TableCell>
                      <TableCell>
                        <Checkbox
                          checked={user.is_admin}
                          disabled={
                            users.pending ||
                            user.id === users.capabilities?.actor_id
                          }
                          inputProps={{
                            "aria-label": `${user.username}: is_admin`,
                          }}
                          onChange={(event) =>
                            setConfirmation({
                              user,
                              admin: event.target.checked,
                            })
                          }
                        />
                      </TableCell>
                      {slugs.map((slug) => {
                        const cell = user.services[slug];
                        const native = user.native[slug];
                        const explanation =
                          slug === "jenkins"
                            ? "Jenkins is excluded: existing access is read-only and never changed by this panel."
                            : cell.readonly
                              ? "This permission cannot be changed until the service consumer is ready."
                              : user.is_admin
                                ? "is_admin grants all managed services, excluding Jenkins."
                                : "Requested permission and effective account readiness are different.";
                        return (
                          <TableCell key={slug}>
                            <Tooltip title={explanation}>
                              <span>
                                <Checkbox
                                  checked={cell.granted === true}
                                  disabled={
                                    users.pending ||
                                    user.is_admin ||
                                    cell.readonly ||
                                    slug === "jenkins"
                                  }
                                  inputProps={{
                                    "aria-label": `${user.username}: ${slug}`,
                                  }}
                                  onChange={(event) => {
                                    if (slug !== "jenkins")
                                      void users.update(user, {
                                        services: {
                                          [slug]: event.target.checked,
                                        },
                                      });
                                  }}
                                />
                              </span>
                            </Tooltip>
                            {native && (
                              <Typography display="block" variant="caption">
                                {nativeProgress(native)}
                              </Typography>
                            )}
                            {users.capabilities?.native_scheduling_enabled &&
                              native?.management &&
                              (slug === "gitlab" ||
                                slug === "matrix" ||
                                slug === "minio") && (
                                <NativeManagementControl
                                  user={user}
                                  service={slug}
                                  management={native.management}
                                  actorId={users.capabilities!.actor_id}
                                  pending={users.pending}
                                  change={users.manageNative}
                                />
                              )}
                            {!native &&
                              user.is_active &&
                              cell.granted &&
                              !cell.effective && (
                                <Typography display="block" variant="caption">
                                  Not ready
                                </Typography>
                              )}
                          </TableCell>
                        );
                      })}
                      <TableCell>
                        <Button
                          disabled={users.pending}
                          onClick={() => setEditing(user)}
                        >
                          Edit profile
                        </Button>
                        <Button
                          disabled={
                            users.pending ||
                            user.id === users.capabilities?.actor_id
                          }
                          color={user.is_active ? "warning" : "primary"}
                          onClick={() => setConfirmation({ user })}
                        >
                          {user.is_active ? "Deactivate" : "Reactivate"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {!users.data.results.length && (
              <Typography mt={2}>No users on this page.</Typography>
            )}
            <Stack direction="row" alignItems="center" gap={2} mt={2}>
              <Button
                disabled={users.pending || users.data.page <= 1}
                onClick={() => users.setPage(users.data.page - 1)}
              >
                Previous
              </Button>
              <Typography>
                Page {users.data.page} · {users.data.count} users
              </Typography>
              <Button
                disabled={users.pending || users.data.next_page === null}
                onClick={() => {
                  if (users.data.next_page !== null)
                    users.setPage(users.data.next_page);
                }}
              >
                Next
              </Button>
            </Stack>
          </Box>
          {editing && (
            <EditUserProfile
              key={editing.id}
              user={editing}
              pending={users.pending}
              save={users.update}
              close={() => setEditing(null)}
            />
          )}
          <Dialog
            open={confirmation !== null}
            onClose={() => {
              if (!users.pending) setConfirmation(null);
            }}
          >
            <DialogTitle>
              {confirmation?.admin !== undefined
                ? "Change administrator permission"
                : confirmation?.user.is_active
                  ? "Deactivate user"
                  : "Reactivate user"}
            </DialogTitle>
            <DialogContent>
              <Typography>{confirmation?.user.username}</Typography>
              <Typography>
                Central access changes immediately. Native outcomes are reported
                separately; no data or account is deleted. Reactivation never
                restores revoked credentials. Jenkins is excluded.
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button
                disabled={users.pending}
                onClick={() => setConfirmation(null)}
              >
                Cancel
              </Button>
              <Button
                disabled={users.pending}
                onClick={() => {
                  void confirm();
                }}
              >
                Confirm change
              </Button>
            </DialogActions>
          </Dialog>
        </>
      )}
    </Stack>
  );
}
