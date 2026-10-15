import { describe, expect, it } from "vitest";
import { validateConnectParams } from "./validation";

describe("validateConnectParams", () => {
  const validState = "random_state_12345678-abc_XYZ";
  const validCallback = "http://127.0.0.1:23456/auth/callback";
  const expectedErrorMessage = "This sign-in link isn't valid. Start again from the desktop app.";

  it("accepts valid callback and state with 127.0.0.1", () => {
    const result = validateConnectParams(validCallback, validState);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.callbackUrl).toBe("http://127.0.0.1:23456/auth/callback");
      expect(result.state).toBe(validState);
    }
  });

  it("accepts valid callback and state with localhost", () => {
    const result = validateConnectParams("http://localhost:54321/auth/callback", "state12345");
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.callbackUrl).toBe("http://localhost:54321/auth/callback");
      expect(result.state).toBe("state12345");
    }
  });

  it("rejects https protocol", () => {
    const result = validateConnectParams("https://127.0.0.1:23456/auth/callback", validState);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe(expectedErrorMessage);
    }
  });

  it("rejects non-loopback hosts", () => {
    const result = validateConnectParams("http://example.com:23456/auth/callback", validState);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe(expectedErrorMessage);
    }

    const lanResult = validateConnectParams("http://192.168.1.5:23456/auth/callback", validState);
    expect(lanResult.valid).toBe(false);
    if (!lanResult.valid) {
      expect(lanResult.error).toBe(expectedErrorMessage);
    }
  });

  it("rejects missing or empty port", () => {
    const result = validateConnectParams("http://127.0.0.1/auth/callback", validState);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe(expectedErrorMessage);
    }
  });

  it("rejects out of range port", () => {
    const zeroResult = validateConnectParams("http://127.0.0.1:0/auth/callback", validState);
    expect(zeroResult.valid).toBe(false);
    if (!zeroResult.valid) {
      expect(zeroResult.error).toBe(expectedErrorMessage);
    }

    const highResult = validateConnectParams("http://127.0.0.1:70000/auth/callback", validState);
    expect(highResult.valid).toBe(false);
    if (!highResult.valid) {
      expect(highResult.error).toBe(expectedErrorMessage);
    }
  });

  it("rejects invalid path", () => {
    const result = validateConnectParams("http://127.0.0.1:23456/callback", validState);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe(expectedErrorMessage);
    }
  });

  it("rejects credentials in URL", () => {
    const result = validateConnectParams(
      "http://user:pass@127.0.0.1:23456/auth/callback",
      validState,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe(expectedErrorMessage);
    }
  });

  it("rejects state that is too short (< 8 chars)", () => {
    const result = validateConnectParams(validCallback, "short");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe(expectedErrorMessage);
    }
  });

  it("rejects state with illegal characters", () => {
    const result = validateConnectParams(validCallback, "invalid state with spaces");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe(expectedErrorMessage);
    }

    const result2 = validateConnectParams(validCallback, "invalid@state!special");
    expect(result2.valid).toBe(false);
    if (!result2.valid) {
      expect(result2.error).toBe(expectedErrorMessage);
    }
  });

  it("rejects null or missing parameters", () => {
    expect(validateConnectParams(null, validState).valid).toBe(false);
    expect(validateConnectParams(validCallback, null).valid).toBe(false);
    expect(validateConnectParams(undefined, undefined).valid).toBe(false);
  });
});
