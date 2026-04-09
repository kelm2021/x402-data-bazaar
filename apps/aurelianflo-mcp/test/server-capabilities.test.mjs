import test from "node:test";
import assert from "node:assert/strict";

import { buildServerCapabilitiesPayload } from "../src/server-capabilities.js";

test("server capabilities advertises batch wallet screening as a first-class paid workflow", () => {
  const payload = buildServerCapabilitiesPayload("https://api.aurelianflo.com");
  const batchFlow = payload.recommendedFlows.find((flow) => flow.id === "batch_wallet_screening");
  const eddFlow = payload.recommendedFlows.find((flow) => flow.id === "edd_memo");
  const paidBatchTool = payload.tools.paid.find((tool) => tool.name === "batch_wallet_screen");
  const paidEddTool = payload.tools.paid.find((tool) => tool.name === "edd_report");

  assert.ok(batchFlow);
  assert.ok(eddFlow);
  assert.deepEqual(batchFlow.tools, [
    "batch_wallet_screen",
    "report_pdf_generate",
    "report_docx_generate",
  ]);
  assert.deepEqual(batchFlow.outputFormats, ["json", "pdf", "docx"]);
  assert.match(batchFlow.summary, /batch|proceed|pause/i);
  assert.deepEqual(eddFlow.tools, ["edd_report"]);
  assert.deepEqual(eddFlow.outputFormats, ["json", "pdf", "docx"]);
  assert.match(eddFlow.summary, /enhanced due diligence|evidence|follow-up/i);
  assert.equal(paidBatchTool.pricing, "$0.1");
  assert.equal(paidEddTool.pricing, "$0.25");
  assert.equal(payload.payment.requiredFor.includes("batch_wallet_screen"), true);
  assert.equal(payload.payment.requiredFor.includes("edd_report"), true);
});
