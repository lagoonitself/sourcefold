import { browser } from "wxt/browser";
import type { AccountRequest, AccountResponse, AccountStatus } from "./account";
import type { ResolvedTarget } from "./target";

// The popup and the options page reach the account through the background worker, which owns
// the sign-ins and runs the local API (lib/account.ts). Code running in the background itself
// calls the handlers directly.

export interface AccountHandlers {
  resolveTarget(forceRefresh: boolean): Promise<ResolvedTarget>;
  fetch(request: AccountRequest): Promise<AccountResponse>;
  status(): Promise<AccountStatus>;
  signIn(): Promise<AccountStatus>;
  signOut(): Promise<void>;
}

type Message =
  | { type: "sourcefold:account"; op: "resolveTarget"; forceRefresh: boolean }
  | { type: "sourcefold:account"; op: "fetch"; request: AccountRequest }
  | { type: "sourcefold:account"; op: "status" | "signIn" | "signOut" };

type Answer<T> = { ok: true; value: T } | { ok: false; error: string };

let local: AccountHandlers | null = null;

function run(handlers: AccountHandlers, message: Message): Promise<unknown> {
  switch (message.op) {
    case "resolveTarget":
      return handlers.resolveTarget(message.forceRefresh);
    case "fetch":
      return handlers.fetch(message.request);
    case "status":
      return handlers.status();
    case "signIn":
      return handlers.signIn();
    case "signOut":
      return handlers.signOut();
  }
}

/** Background: answers the popup and options page, and serves its own calls directly. */
export function serveAccountChannel(handlers: AccountHandlers): void {
  local = handlers;
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const msg = message as Message | undefined;
    if (msg?.type !== "sourcefold:account") return;
    run(handlers, msg).then(
      (value) => sendResponse({ ok: true, value } satisfies Answer<unknown>),
      (err: unknown) =>
        sendResponse({
          ok: false,
          error: err instanceof Error && err.message ? err.message : "Something went wrong.",
        } satisfies Answer<unknown>),
    );
    return true;
  });
}

async function call<T>(message: Message): Promise<T> {
  if (local) return (await run(local, message)) as T;
  const answer = (await browser.runtime.sendMessage(message)) as Answer<T> | undefined;
  if (!answer) throw new Error("The extension's background didn't answer. Reload the extension.");
  if (!answer.ok) throw new Error(answer.error);
  return answer.value;
}

export function resolveTarget(options: { forceRefresh?: boolean } = {}): Promise<ResolvedTarget> {
  return call({
    type: "sourcefold:account",
    op: "resolveTarget",
    forceRefresh: Boolean(options.forceRefresh),
  });
}

export function accountFetch(request: AccountRequest): Promise<AccountResponse> {
  return call({ type: "sourcefold:account", op: "fetch", request });
}

export function accountStatus(): Promise<AccountStatus> {
  return call({ type: "sourcefold:account", op: "status" });
}

export function signIn(): Promise<AccountStatus> {
  return call({ type: "sourcefold:account", op: "signIn" });
}

export function signOut(): Promise<void> {
  return call({ type: "sourcefold:account", op: "signOut" });
}
