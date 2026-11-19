import { describe, expect, it } from "vitest";
import { isBlockedIp } from "../src/agent/sentinel";

describe("network guard", () => {
  it("blocks loopback and private ranges", () => {
    for (const ip of ["127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.169.254", "::1"]) expect(isBlockedIp(ip)).toBe(true);
    expect(isBlockedIp("1.1.1.1")).toBe(false);
  });
});
