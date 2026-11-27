import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";

/** Overlay shown over the 3D tray when it cannot draw (context lost or render error) */
export function TrayUnavailable({
  message,
  onReload,
}: {
  message: string;
  onReload: () => void;
}) {
  return (
    <Box
      component="div"
      role="alert"
      sx={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
        bgcolor: "background.default",
        p: 2,
        textAlign: "center",
      }}
    >
      <Typography variant="body2">{message}</Typography>
      <Button variant="outlined" size="small" onClick={onReload}>
        Reload tray
      </Button>
    </Box>
  );
}
