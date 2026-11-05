import * as React from "react";
import { Check, CircleAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { isTauri } from "@/lib/api";
import {
  checkForUpdate,
  getAppVersion,
  getUpdateState,
  installUpdate,
  subscribeUpdate,
} from "./update-store";

/** Settings → General → Updates: this version, a check button, and Update and restart. */
export function UpdateSettings() {
  const state = React.useSyncExternalStore(subscribeUpdate, getUpdateState);
  const [version, setVersion] = React.useState<string | null>(null);

  React.useEffect(() => {
    void getAppVersion().then(setVersion);
  }, []);

  const working =
    state.kind === "checking" || state.kind === "downloading" || state.kind === "restarting";

  let line: { icon: "ok" | "warn" | "busy" | null; text: string } | null = null;
  if (state.kind === "checking") line = { icon: "busy", text: "Checking…" };
  else if (state.kind === "current") line = { icon: "ok", text: "You have the newest version." };
  else if (state.kind === "available")
    line = { icon: null, text: `Sourcefold ${state.version} is ready to install.` };
  else if (state.kind === "downloading")
    line = {
      icon: "busy",
      text:
        state.percent === null
          ? `Downloading ${state.version}…`
          : `Downloading ${state.version}… ${state.percent}%`,
    };
  else if (state.kind === "restarting")
    line = { icon: "busy", text: `Installing ${state.version}. The app restarts by itself.` };
  else if (state.kind === "error") line = { icon: "warn", text: state.message };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-[13.5px] font-medium text-foreground">Updates</span>
        <p className="text-[12.5px] leading-[18px] text-muted-foreground">
          {version ? `You're on Sourcefold ${version}. ` : ""}The app checks for new versions when
          it starts and installs them when you say so.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {state.kind === "available" ? (
          <Button type="button" size="sm" onClick={() => void installUpdate()}>
            Update and restart
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void checkForUpdate()}
            disabled={working || !isTauri()}
          >
            Check for updates
          </Button>
        )}
        {line && (
          <p
            role="status"
            className="flex items-start gap-1.5 text-[12.5px] leading-[18px] text-foreground"
          >
            {line.icon === "ok" && <Check className="mt-0.5 size-3.5 shrink-0 text-success" />}
            {line.icon === "warn" && (
              <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            )}
            {line.icon === "busy" && (
              <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" />
            )}
            <span>{line.text}</span>
          </p>
        )}
      </div>
    </div>
  );
}
