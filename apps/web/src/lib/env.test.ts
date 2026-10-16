import { afterEach, describe, expect, it } from "vitest";
import { isEmailAllowed } from "./env";

const original = process.env.ALLOWED_EMAIL;

afterEach(() => {
  process.env.ALLOWED_EMAIL = original;
});

describe("isEmailAllowed", () => {
  it("allows only listed emails, ignoring case and spaces", () => {
    process.env.ALLOWED_EMAIL = "a@example.com, B@Example.com";
    expect(isEmailAllowed("A@example.com")).toBe(true);
    expect(isEmailAllowed(" b@example.com ")).toBe(true);
    expect(isEmailAllowed("c@example.com")).toBe(false);
    expect(isEmailAllowed(null)).toBe(false);
  });

  it("lets any account in with *", () => {
    process.env.ALLOWED_EMAIL = "*";
    expect(isEmailAllowed("anyone@example.com")).toBe(true);
    expect(isEmailAllowed("")).toBe(false);
    expect(isEmailAllowed(undefined)).toBe(false);
  });

  it("throws when ALLOWED_EMAIL is unset", () => {
    delete process.env.ALLOWED_EMAIL;
    expect(() => isEmailAllowed("a@example.com")).toThrow();
  });
});
