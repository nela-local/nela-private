import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseTelegramSendArgs } from "./telegramSend.js";
import { parseTelegramReadArgs } from "./telegramRead.js";
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

describe("parseTelegramReadArgs", () => {
  it("defaults to listing a few recent chats", () => {
    const parsed = parseTelegramReadArgs({});
    assert.equal(parsed.chat, null);
    assert.equal(parsed.maxResults, 5);
  });

  it("reads history for a saved name", () => {
    const parsed = parseTelegramReadArgs({
      chat: "Priya Sharma",
      max_results: 10,
    });
    assert.equal(parsed.chat, "Priya Sharma");
    assert.equal(parsed.maxResults, 10);
  });

  it("caps history at 20 and dialogs at 10", () => {
    assert.equal(parseTelegramReadArgs({ chat: "Priya", max_results: 99 }).maxResults, 20);
    assert.equal(parseTelegramReadArgs({ max_results: 99 }).maxResults, 10);
  });
});

describe("looksLikeTelegramRequest", () => {
  it("detects telegram phrasing", () => {
    assert.equal(looksLikeTelegramRequest("Message Priya on Telegram"), true);
    assert.equal(looksLikeTelegramRequest("send a telegram to finance"), true);
    assert.equal(looksLikeTelegramRequest("What is the capital of France?"), false);
  });
});
