import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fileExtension,
  isChatAttachablePath,
  isImageAttachablePath,
} from "./ragUiActions.js";

describe("chat drop path filters", () => {
  it("reads extensions from unix and windows paths", () => {
    assert.equal(fileExtension("/home/a/report.PDF"), "pdf");
    assert.equal(fileExtension("C:\\Users\\a\\notes.docx"), "docx");
    assert.equal(fileExtension("noext"), "");
  });

  it("accepts chat-attachable document types", () => {
    assert.equal(isChatAttachablePath("/tmp/deck.pptx"), true);
    assert.equal(isChatAttachablePath("/tmp/shot.png"), true);
    assert.equal(isChatAttachablePath("/tmp/archive.zip"), false);
  });

  it("limits vision drops to images", () => {
    assert.equal(isImageAttachablePath("/tmp/photo.jpeg"), true);
    assert.equal(isImageAttachablePath("/tmp/brief.pdf"), false);
  });
});
