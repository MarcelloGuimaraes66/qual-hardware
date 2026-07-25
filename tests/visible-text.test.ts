import { describe, expect, it } from "vitest";
import { visibleText } from "../src/web/visibleText.js";

describe("brand-neutral window copy", () => {
  it("removes legacy product references from dynamic text shown in windows", () => {
    const text = visibleText("Perceptrum GPU · perceptrum-workload · perceptrum-build");
    expect(text.toLowerCase()).not.toContain("perceptrum");
    expect(text).toContain("aceleração por GPU");
    expect(text).toContain("qual-hardware-workload");
    expect(text).toContain("perfil de software");
  });

  it("translates legacy calibration errors into operator language", () => {
    expect(visibleText("calibration_perceptrum_build_not_supported")).toBe(
      "O perfil de software desta carga não é compatível com a qualificação solicitada.",
    );
  });
});
