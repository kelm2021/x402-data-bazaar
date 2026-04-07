import z from "zod";

const jsonPrimitiveValueSchema = {
  anyOf: [
    { type: "string" },
    { type: "number" },
    { type: "integer" },
    { type: "boolean" },
    { type: "null" },
  ],
};

const reportMetaInputSchema = {
  type: "object",
  properties: {
    report_type: { type: "string", description: "Optional report classification." },
    title: { type: "string", description: "Report title shown in the generated artifact." },
    author: { type: "string", description: "Author or generating system." },
  },
  additionalProperties: true,
};

const reportMetricInputSchema = {
  type: "object",
  properties: {
    label: { type: "string", description: "Metric label shown in the report." },
    value: { ...jsonPrimitiveValueSchema, description: "Metric value." },
    unit: { type: "string", description: "Optional unit for the metric value." },
  },
  required: ["label"],
  additionalProperties: false,
};

const reportTableInputSchema = {
  type: "object",
  properties: {
    columns: {
      type: "array",
      description: "Ordered table column labels.",
      items: { type: "string" },
    },
    rows: {
      type: "array",
      description: "Table row objects keyed by column name.",
      items: {
        type: "object",
        additionalProperties: true,
      },
    },
  },
  required: ["columns", "rows"],
  additionalProperties: false,
};

const sharedReportShape = {
  report_meta: z.object({
    report_type: z.string().describe("Optional report classification.").optional(),
    title: z.string().describe("Report title shown in the generated artifact.").optional(),
    author: z.string().describe("Author or generating system.").optional(),
  }),
  executive_summary: z.array(z.string().describe("Executive summary bullet.")).describe("Optional executive summary bullets.").optional(),
  headline_metrics: z
    .array(
      z.object({
        label: z.string().describe("Metric label shown in the report."),
        value: z.union([z.string(), z.number(), z.boolean()]).describe("Metric value.").optional(),
        unit: z.string().describe("Optional unit for the metric value.").optional(),
      }),
    )
    .describe("Optional headline metrics rendered near the top of the report.")
    .optional(),
  tables: z.record(
    z.object({
      columns: z.array(z.string().describe("Ordered table column label.")).describe("Ordered table column labels."),
      rows: z.array(z.record(z.any()).describe("Table row object keyed by column name.")).describe("Table row objects keyed by column name."),
    }),
  ).describe("Named tables rendered into the report artifact."),
  export_artifacts: z.record(z.any()).describe("Optional prior export metadata carried alongside the report payload.").optional(),
  result: z.record(z.any()).describe("Optional raw result payload attached for audit or downstream use.").optional(),
};

const sharedReportInputSchema = {
  type: "object",
  properties: {
    report_meta: reportMetaInputSchema,
    executive_summary: {
      type: "array",
      description: "Optional executive summary bullets.",
      items: { type: "string" },
    },
    headline_metrics: {
      type: "array",
      description: "Optional headline metrics rendered near the top of the report.",
      items: reportMetricInputSchema,
    },
    tables: {
      type: "object",
      description: "Named tables rendered into the report artifact.",
      additionalProperties: reportTableInputSchema,
    },
    export_artifacts: {
      type: "object",
      description: "Optional prior export metadata carried alongside the report payload.",
      additionalProperties: true,
    },
    result: {
      type: "object",
      description: "Optional raw result payload attached for audit or downstream use.",
      additionalProperties: true,
    },
  },
  required: ["report_meta", "tables"],
  additionalProperties: false,
};

export const MCP_TOOL_DEFINITIONS = [
  {
    name: "server_capabilities",
    description:
      "Free capability and connection check for AurelianFlo, including direct and Smithery-hosted access modes and which tools require x402 payment.",
    price: 0,
    route: null,
    annotations: {
      title: "Server Capabilities",
      readOnlyHint: true,
    },
    required: [],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    zodShape: {},
    inputExample: {},
  },
  {
    name: "ofac_wallet_report",
    description:
      "Run exact-match OFAC wallet screening and return either the structured screening payload or a PDF or DOCX artifact.",
    price: 0.205,
    route: {
      method: "GET",
      pathTemplate: "/api/ofac-wallet-screen/{address}",
    },
    annotations: {
      title: "OFAC Wallet Screen Report",
      readOnlyHint: true,
    },
    required: ["address", "output_format"],
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          minLength: 10,
          description: "Wallet address to screen against OFAC SDN digital currency designations.",
        },
        asset: {
          type: "string",
          minLength: 2,
          description: "Optional asset or network ticker filter such as ETH, USDC, XBT, TRX, ARB, or BSC.",
        },
        output_format: {
          type: "string",
          enum: ["json", "pdf", "docx"],
          description: "Select json for the structured report payload or pdf|docx for a generated artifact.",
        },
      },
      required: ["address", "output_format"],
      additionalProperties: false,
    },
    zodShape: {
      address: z
        .string()
        .min(10)
        .describe("Wallet address to screen against OFAC SDN digital currency designations."),
      asset: z
        .string()
        .min(2)
        .describe("Optional asset or network ticker filter such as ETH, USDC, XBT, TRX, ARB, or BSC.")
        .optional(),
      output_format: z
        .enum(["json", "pdf", "docx"])
        .describe("Select json for the structured report payload or pdf|docx for a generated artifact."),
    },
    inputExample: {
      address: "0x098B716B8Aaf21512996dC57EB0615e2383E2f96",
      asset: "ETH",
      output_format: "pdf",
    },
  },
  {
    name: "ofac_wallet_screen",
    description:
      "Screen a wallet address against OFAC SDN digital currency address designations, returning exact hits, sanctioned entity metadata, asset coverage, and a manual-review signal.",
    price: 0.005,
    route: {
      method: "GET",
      pathTemplate: "/api/ofac-wallet-screen/{address}",
    },
    annotations: {
      title: "OFAC Wallet Screen",
      readOnlyHint: true,
    },
    required: ["address"],
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          minLength: 10,
          description: "Wallet address to screen against OFAC SDN digital currency designations.",
        },
        asset: {
          type: "string",
          minLength: 2,
          description: "Optional asset or network ticker filter such as ETH, USDC, XBT, TRX, ARB, or BSC.",
        },
      },
      required: ["address"],
      additionalProperties: false,
    },
    zodShape: {
      address: z
        .string()
        .min(10)
        .describe("Wallet address to screen against OFAC SDN digital currency designations."),
      asset: z
        .string()
        .min(2)
        .describe("Optional asset or network ticker filter such as ETH, USDC, XBT, TRX, ARB, or BSC.")
        .optional(),
    },
    inputExample: {
      address: "0x098B716B8Aaf21512996dC57EB0615e2383E2f96",
      asset: "ETH",
    },
  },
  {
    name: "batch_wallet_screen",
    description:
      "Screen a batch of wallet addresses against OFAC SDN digital currency address designations, returning per-wallet results plus a batch-level proceed-or-pause decision and structured output.",
    price: 0.025,
    route: {
      method: "POST",
      pathTemplate: "/api/workflows/compliance/batch-wallet-screen",
    },
    annotations: {
      title: "Batch Wallet Screen",
      readOnlyHint: true,
    },
    required: ["addresses"],
    inputSchema: {
      type: "object",
      properties: {
        addresses: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "string",
            minLength: 10,
          },
          description: "Wallet addresses to screen against OFAC SDN digital currency designations.",
        },
        asset: {
          type: "string",
          minLength: 2,
          description: "Optional asset or network ticker filter such as ETH, USDC, XBT, TRX, ARB, or BSC.",
        },
      },
      required: ["addresses"],
      additionalProperties: false,
    },
    zodShape: {
      addresses: z
        .array(
          z
            .string()
            .min(10)
            .describe("Wallet address to screen against OFAC SDN digital currency designations."),
        )
        .min(1)
        .max(100)
        .describe("Wallet addresses to screen against OFAC SDN digital currency designations."),
      asset: z
        .string()
        .min(2)
        .describe("Optional asset or network ticker filter such as ETH, USDC, XBT, TRX, ARB, or BSC.")
        .optional(),
    },
    inputExample: {
      addresses: [
        "0x098B716B8Aaf21512996dC57EB0615e2383E2f96",
        "0x1111111111111111111111111111111111111111",
      ],
      asset: "ETH",
    },
  },
  {
    name: "edd_report",
    description:
      "Generate an enhanced due diligence memo for a wallet set using exact-match OFAC screening, evidence summary, required follow-up, and JSON, PDF, or DOCX output.",
    price: 0.09,
    route: {
      method: "POST",
      pathTemplate: "/api/workflows/compliance/edd-report",
    },
    annotations: {
      title: "EDD Report",
      readOnlyHint: true,
    },
    required: ["subject_name", "addresses", "output_format"],
    inputSchema: {
      type: "object",
      properties: {
        subject_name: {
          type: "string",
          minLength: 2,
          description: "Human-readable subject or counterparty name for the memo.",
        },
        case_name: {
          type: "string",
          description: "Optional case or review title shown in the memo.",
        },
        review_reason: {
          type: "string",
          description: "Optional reason the EDD memo is being prepared.",
        },
        jurisdiction: {
          type: "string",
          description: "Optional jurisdiction or operating region for the case.",
        },
        requested_by: {
          type: "string",
          description: "Optional requester, owner, or reviewing team.",
        },
        reference_id: {
          type: "string",
          description: "Optional internal case or review reference.",
        },
        output_format: {
          type: "string",
          enum: ["json", "pdf", "docx"],
          description: "Select json for the structured memo payload or pdf|docx for a generated artifact.",
        },
        addresses: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "string",
            minLength: 10,
          },
          description: "Wallet addresses to include in the enhanced due diligence memo.",
        },
        asset: {
          type: "string",
          minLength: 2,
          description: "Optional asset or network ticker filter such as ETH, USDC, XBT, TRX, ARB, or BSC.",
        },
      },
      required: ["subject_name", "addresses", "output_format"],
      additionalProperties: false,
    },
    zodShape: {
      subject_name: z
        .string()
        .min(2)
        .describe("Human-readable subject or counterparty name for the memo."),
      case_name: z.string().describe("Optional case or review title shown in the memo.").optional(),
      review_reason: z.string().describe("Optional reason the EDD memo is being prepared.").optional(),
      jurisdiction: z.string().describe("Optional jurisdiction or operating region for the case.").optional(),
      requested_by: z.string().describe("Optional requester, owner, or reviewing team.").optional(),
      reference_id: z.string().describe("Optional internal case or review reference.").optional(),
      output_format: z
        .enum(["json", "pdf", "docx"])
        .describe("Select json for the structured memo payload or pdf|docx for a generated artifact."),
      addresses: z
        .array(
          z
            .string()
            .min(10)
            .describe("Wallet address to include in the enhanced due diligence memo."),
        )
        .min(1)
        .max(100)
        .describe("Wallet addresses to include in the enhanced due diligence memo."),
      asset: z
        .string()
        .min(2)
        .describe("Optional asset or network ticker filter such as ETH, USDC, XBT, TRX, ARB, or BSC.")
        .optional(),
    },
    inputExample: {
      subject_name: "Northwind Treasury Counterparty",
      case_name: "Counterparty onboarding review",
      review_reason: "Treasury payout review",
      jurisdiction: "US",
      requested_by: "ops@northwind.example",
      reference_id: "case-2026-04-07-001",
      output_format: "pdf",
      addresses: [
        "0x098B716B8Aaf21512996dC57EB0615e2383E2f96",
        "0x1111111111111111111111111111111111111111",
      ],
      asset: "ETH",
    },
  },
  {
    name: "monte_carlo_report",
    description:
      "Run a supported Monte Carlo workflow and return either the structured report payload or a PDF or DOCX artifact.",
    price: 0.29,
    route: {
      method: "POST",
      pathTemplate: "/api/sim/report",
    },
    annotations: {
      title: "Monte Carlo Report",
      readOnlyHint: true,
    },
    required: ["analysis_type", "request", "output_format"],
    inputSchema: {
      type: "object",
      properties: {
        analysis_type: {
          type: "string",
          description: "Simulation workflow to summarize into a report or generated artifact.",
          enum: [
            "probability",
            "batch-probability",
            "compare",
            "sensitivity",
            "forecast",
            "composed",
            "optimize",
          ],
        },
        title: { type: "string", description: "Optional report title override." },
        summary_focus: { type: "string", description: "Optional summary emphasis or focus area." },
        request: {
          type: "object",
          description: "Underlying simulation request payload.",
          additionalProperties: true,
        },
        output_format: {
          type: "string",
          enum: ["json", "pdf", "docx"],
          description: "Select json for the structured report payload or pdf|docx for a generated artifact.",
        },
      },
      required: ["analysis_type", "request", "output_format"],
      additionalProperties: false,
    },
    zodShape: {
      analysis_type: z
        .enum([
          "probability",
          "batch-probability",
          "compare",
          "sensitivity",
          "forecast",
          "composed",
          "optimize",
        ])
        .describe("Simulation workflow to summarize into a report or generated artifact."),
      title: z.string().describe("Optional report title override.").optional(),
      summary_focus: z.string().describe("Optional summary emphasis or focus area.").optional(),
      request: z.record(z.any()).describe("Underlying simulation request payload."),
      output_format: z
        .enum(["json", "pdf", "docx"])
        .describe("Select json for the structured report payload or pdf|docx for a generated artifact."),
    },
    inputExample: {
      analysis_type: "compare",
      title: "Candidate vs baseline decision memo",
      summary_focus: "decision",
      output_format: "pdf",
      request: {
        baseline: {
          parameters: {
            demand_signal: 0.65,
            execution_quality: 0.6,
            pricing_pressure: -0.25,
          },
          threshold: 0.25,
        },
        candidate: {
          parameters: {
            demand_signal: 0.78,
            execution_quality: 0.68,
            pricing_pressure: -0.2,
          },
          threshold: 0.25,
        },
      },
    },
  },
  {
    name: "monte_carlo_decision_report",
    description:
      "Generate a structured decision report from any supported Monte Carlo workflow, including executive summary, headline metrics, and spreadsheet-friendly tables.",
    price: 0.09,
    route: {
      method: "POST",
      pathTemplate: "/api/sim/report",
    },
    annotations: {
      title: "Monte Carlo Decision Report",
      readOnlyHint: true,
    },
    required: ["analysis_type", "request"],
    inputSchema: {
      type: "object",
      properties: {
        analysis_type: {
          type: "string",
          description: "Simulation workflow to summarize into a decision report.",
          enum: [
            "probability",
            "batch-probability",
            "compare",
            "sensitivity",
            "forecast",
            "composed",
            "optimize",
          ],
        },
        title: { type: "string", description: "Optional report title override." },
        summary_focus: { type: "string", description: "Optional summary emphasis or focus area." },
        request: {
          type: "object",
          description: "Underlying simulation request payload.",
          additionalProperties: true,
        },
      },
      required: ["analysis_type", "request"],
      additionalProperties: false,
    },
    zodShape: {
      analysis_type: z
        .enum([
          "probability",
          "batch-probability",
          "compare",
          "sensitivity",
          "forecast",
          "composed",
          "optimize",
        ])
        .describe("Simulation workflow to summarize into a decision report."),
      title: z.string().describe("Optional report title override.").optional(),
      summary_focus: z.string().describe("Optional summary emphasis or focus area.").optional(),
      request: z.record(z.any()).describe("Underlying simulation request payload."),
    },
    inputExample: {
      analysis_type: "compare",
      title: "Candidate vs baseline decision memo",
      summary_focus: "decision",
      request: {
        baseline: {
          parameters: {
            demand_signal: 0.65,
            execution_quality: 0.6,
            pricing_pressure: -0.25,
          },
          threshold: 0.25,
        },
        candidate: {
          parameters: {
            demand_signal: 0.78,
            execution_quality: 0.68,
            pricing_pressure: -0.2,
          },
          threshold: 0.25,
        },
      },
    },
  },
  {
    name: "report_pdf_generate",
    description:
      "Generate a PDF artifact from structured report tables, metrics, and summary content.",
    price: 0.2,
    route: {
      method: "POST",
      pathTemplate: "/api/tools/report/pdf/generate",
    },
    annotations: {
      title: "Report PDF Generate",
      readOnlyHint: true,
    },
    required: ["report_meta", "tables"],
    inputSchema: sharedReportInputSchema,
    zodShape: sharedReportShape,
    inputExample: {
      report_meta: { report_type: "ops-brief", title: "Weekly Ops Brief", author: "AurelianFlo" },
      executive_summary: [
        "Core routes stayed available through the reporting window.",
        "Manual review remains recommended for billing anomalies.",
      ],
      tables: {
        route_health: {
          columns: ["route", "status"],
          rows: [{ route: "/api/tools/report/pdf/generate", status: "healthy" }],
        },
      },
    },
  },
  {
    name: "report_docx_generate",
    description:
      "Generate a DOCX artifact from structured report tables, metrics, and summary content.",
    price: 0.16,
    route: {
      method: "POST",
      pathTemplate: "/api/tools/report/docx/generate",
    },
    annotations: {
      title: "Report DOCX Generate",
      readOnlyHint: true,
    },
    required: ["report_meta", "tables"],
    inputSchema: sharedReportInputSchema,
    zodShape: sharedReportShape,
    inputExample: {
      report_meta: { report_type: "board-update", title: "Board Update", author: "AurelianFlo" },
      executive_summary: ["Highlights are ready for review."],
      tables: {
        pipeline: {
          columns: ["stage", "status"],
          rows: [{ stage: "Draft", status: "complete" }],
        },
      },
    },
  },
];

export function getToolDefinition(name) {
  return MCP_TOOL_DEFINITIONS.find((tool) => tool.name === name) || null;
}
