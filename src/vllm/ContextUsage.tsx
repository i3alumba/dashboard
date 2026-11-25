import { Tooltip, Typography } from "@mui/material";

export default function ContextUsage({
  used,
  limit,
}: {
  used: number | null;
  limit: number | null;
}) {
  if (limit !== 16384) return null;
  const label =
    used === null ? "—/16k" : `${((used / limit) * 100).toFixed(1)}%/16k`;
  const detail = `${used === null ? "Неизвестно" : used}/${limit}. Контекст последнего завершённого запроса: история, шаблон, рассуждения и ответ`;
  return (
    <Tooltip title={detail}>
      <Typography
        component="span"
        variant="caption"
        tabIndex={0}
        aria-label={detail}
        sx={{ whiteSpace: "nowrap" }}
      >
        {label}
      </Typography>
    </Tooltip>
  );
}
