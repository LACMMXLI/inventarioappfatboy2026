import { describe, expect, it } from "vitest";
import { date, money, quantity } from "./api";
describe("Formatos operativos", () => {
  it("presenta MXN y hasta seis decimales", () => {
    expect(money("1234.5")).toContain("1,234.50");
    expect(quantity("0.000001")).toBe("0.000001");
  });
  it("muestra la fecha en México incluso al cruzar medianoche UTC", () => {
    expect(date("2026-10-09T02:00:00Z")).toContain("8");
    expect(date("2026-10-09T02:00:00Z")).toContain("2026");
  });
});
