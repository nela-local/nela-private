import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseTelegramSendArgs } from "./telegramSend.js";
import { looksLikeTelegramRequest } from "./telegramConnectIntent.js";

describe("parseTelegramSendArgs", () => {
  it("accepts @username and body", () => {
    const parsed = parseTelegramSendArgs({
      to: "@priya",
      body: "On my way",
    });
    assert.ok(!("error" in parsed));
    if ("error" in parsed) return;
    assert.equal(parsed.to, "@priya");
    assert.equal(parsed.body, "On my way");
  });

  it("rejects missing chat or body", () => {
    assert.ok("error" in parseTelegramSendArgs({ body: "Hi" }));
    assert.ok("error" in parseTelegramSendArgs({ to: "@priya", body: "  " }));
  });
});

describe("looksLikeTelegramRequest", () => {
  it("detects telegram phrasing", () => {
    assert.equal(looksLikeTelegramRequest("Message Priya on Telegram"), true);
    assert.equal(looksLikeTelegramRequest("send a telegram to finance"), true);
    assert.equal(looksLikeTelegramRequest("What is the capital of France?"), false);
  });
});
