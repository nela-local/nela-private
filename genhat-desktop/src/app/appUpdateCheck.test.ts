import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareVersions, normalizeVersion } from "./appUpdateCheck.js";

describe("appUpdateCheck versions", () => {
  it("normalizes v-prefix", () => {
    assert.equal(normalizeVersion("v0.3.0"), "0.3.0");
    assert.equal(normalizeVersion("0.3.0"), "0.3.0");
  });

  it("orders semver correctly", () => {
    assert.ok(compareVersions("0.3.0", "0.1.1") > 0);
    assert.ok(compareVersions("v0.1.1", "0.3.0") < 0);
    assert.equal(compareVersions("0.3.0", "v0.3.0"), 0);
  });
});
