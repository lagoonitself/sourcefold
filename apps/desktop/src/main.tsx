import React from "react";
import ReactDOM from "react-dom/client";
import { MotionConfig } from "motion/react";
import { Toaster } from "sonner";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import { App } from "./App";
import { AuthProvider } from "./features/auth";
import { isMacPlatform } from "./features/shortcuts/key-utils";
import "./index.css";

// Lets CSS make room for the macOS traffic lights, which sit over the app (see tauri.conf.json).
if (isMacPlatform()) document.documentElement.classList.add("platform-mac");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <App />
      </AuthProvider>
      <Toaster
        position="bottom-right"
        theme="system"
        closeButton
        gap={8}
        toastOptions={{
          classNames: {
            toast:
              "!rounded-[12px] !border-0 !bg-popover !text-popover-foreground !shadow-float !font-sans !text-[13px]",
            description: "!text-muted-foreground",
            actionButton: "!rounded-[7px] !bg-primary !text-primary-foreground !font-medium",
            cancelButton: "!rounded-[7px] !bg-muted !text-foreground",
            closeButton: "!bg-popover !border-border !text-muted-foreground",
          },
        }}
      />
    </MotionConfig>
  </React.StrictMode>,
);
