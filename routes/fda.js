const fetch = require("node-fetch");
const { Router } = require("express");
const router = Router();

const CLASSIFICATION_PRIORITY = {
  "Class I": 3,
  "Class II": 2,
  "Class III": 1,
};

function buildRecallDecision(recalls, queryLabel) {
  if (!recalls.length) {
    return {
      riskLevel: "none",
      summary: `No FDA food recalls matched query "${queryLabel}".`,
      recommendedAction: "No immediate hold action needed. Continue routine monitoring.",
    };
  }

  const classBreakdown = recalls.reduce((accumulator, recall) => {
    const key = recall.classification || "Unclassified";
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
  const highestClassification =
    recalls
      .slice()
      .sort(
        (left, right) =>
          (CLASSIFICATION_PRIORITY[right.classification] || 0) -
          (CLASSIFICATION_PRIORITY[left.classification] || 0),
      )[0]?.classification || "Unclassified";

  if (highestClassification === "Class I") {
    return {
      riskLevel: "critical",
      highestClassification,
      classBreakdown,
      summary: `Class I recalls are present for query "${queryLabel}", indicating a high probability of serious adverse health consequences.`,
      recommendedAction:
        "Immediately quarantine matching inventory, pause fulfillment, and verify affected lot codes before release.",
    };
  }

  if (highestClassification === "Class II") {
    return {
      riskLevel: "high",
      highestClassification,
      classBreakdown,
      summary: `Class II recalls are present for query "${queryLabel}", indicating meaningful health risk if exposure occurs.`,
      recommendedAction:
        "Place suspect items on hold and complete lot-level verification before shipping or sale.",
    };
  }

  return {
    riskLevel: "moderate",
    highestClassification,
    classBreakdown,
    summary: `Only Class III or unclassified recalls are present for query "${queryLabel}".`,
    recommendedAction:
      "Review supplier updates and remove confirmed affected lots during normal quality-control workflows.",
  };
}

function buildAdverseEventDecision({ count, seriousCount, topReactions, drug }) {
  if (!count) {
    return {
      riskLevel: "none",
      summary: `No adverse-event reports were returned for "${drug}".`,
      recommendedAction: "No immediate escalation needed; continue routine monitoring.",
    };
  }

  const seriousRate = seriousCount / count;
  const seriousRatePct = Math.round(seriousRate * 100);

  if (seriousRate >= 0.4) {
    return {
      riskLevel: "high",
      seriousEventRatePct: seriousRatePct,
      summary: `${seriousCount} of ${count} reports (${seriousRatePct}%) are serious for "${drug}".`,
      recommendedAction:
        "Escalate for pharmacovigilance review, inspect recent signal trends, and evaluate risk controls before broad recommendations.",
      watchlistReactions: topReactions.slice(0, 3),
    };
  }

  if (seriousRate >= 0.15) {
    return {
      riskLevel: "elevated",
      seriousEventRatePct: seriousRatePct,
      summary: `${seriousCount} of ${count} reports (${seriousRatePct}%) are serious for "${drug}".`,
      recommendedAction:
        "Maintain active monitoring and trigger manual review if serious reports continue rising.",
      watchlistReactions: topReactions.slice(0, 3),
    };
  }

  return {
    riskLevel: "monitor",
    seriousEventRatePct: seriousRatePct,
    summary: `${seriousCount} of ${count} reports (${seriousRatePct}%) are serious for "${drug}".`,
    recommendedAction:
      "Continue routine monitoring and compare against baseline incidence for similar therapies.",
    watchlistReactions: topReactions.slice(0, 3),
  };
}

router.get("/api/fda/recalls", async (req, res) => {
  try {
    const { query, limit } = req.query;
    const searchLimit = Math.min(parseInt(limit) || 10, 100);
    const search = query ? `reason_for_recall:"${query}"` : "";

    const url = `https://api.fda.gov/food/enforcement.json?search=${encodeURIComponent(search)}&limit=${searchLimit}&sort=report_date:desc`;
    const resp = await fetch(url);
    const raw = await resp.json();

    if (raw.error) {
      return res.status(400).json({ success: false, error: raw.error.message });
    }

    const recalls = (raw.results || []).map((r) => ({
      recallNumber: r.recall_number,
      status: r.status,
      classification: r.classification,
      productDescription: r.product_description,
      reason: r.reason_for_recall,
      company: r.recalling_firm,
      city: r.city,
      state: r.state,
      country: r.country,
      reportDate: r.report_date,
      voluntaryOrMandated: r.voluntary_mandated,
    }));
    const queryLabel = query || "all";
    const decision = buildRecallDecision(recalls, queryLabel);

    res.json({
      success: true,
      data: {
        query: queryLabel,
        count: recalls.length,
        recalls,
        decision,
      },
      source: "openFDA Food Enforcement API",
    });
  } catch (err) {
    res.status(502).json({ success: false, error: "Upstream API error", details: err.message });
  }
});

router.get("/api/fda/adverse-events", async (req, res) => {
  try {
    const drug = String(req.query.drug ?? "aspirin");
    const { limit } = req.query;

    const searchLimit = Math.min(parseInt(limit) || 10, 100);
    const url = `https://api.fda.gov/drug/event.json?search=patient.drug.openfda.brand_name:"${encodeURIComponent(drug)}"&limit=${searchLimit}`;
    const resp = await fetch(url);
    const raw = await resp.json();

    if (raw.error) {
      return res.status(400).json({ success: false, error: raw.error.message });
    }

    const events = (raw.results || []).map((r) => ({
      safetyReportId: r.safetyreportid,
      receiveDate: r.receivedate,
      serious: r.serious === "1",
      reactions: (r.patient?.reaction || []).map((rx) => rx.reactionmeddrapt),
      drugs: (r.patient?.drug || []).map((d) => ({
        name: d.medicinalproduct,
        role: d.drugcharacterization === "1" ? "suspect" : d.drugcharacterization === "2" ? "concomitant" : "interacting",
        indication: d.drugindication,
      })),
    }));
    const seriousCount = events.filter((event) => event.serious).length;
    const reactionCounts = new Map();
    for (const event of events) {
      for (const reaction of event.reactions) {
        const key = String(reaction || "").trim();
        if (!key) {
          continue;
        }
        reactionCounts.set(key, (reactionCounts.get(key) || 0) + 1);
      }
    }
    const topReactions = [...reactionCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([reaction, reportCount]) => ({ reaction, reportCount }));
    const signal = {
      seriousEvents: seriousCount,
      totalEvents: events.length,
      seriousEventRatePct: events.length ? Math.round((seriousCount / events.length) * 100) : 0,
      topReactions,
    };
    const decision = buildAdverseEventDecision({
      count: events.length,
      seriousCount,
      topReactions,
      drug,
    });

    res.json({
      success: true,
      data: {
        drug,
        count: events.length,
        events,
        signal,
        decision,
      },
      source: "openFDA Drug Adverse Events API",
    });
  } catch (err) {
    res.status(502).json({ success: false, error: "Upstream API error", details: err.message });
  }
});

module.exports = router;
