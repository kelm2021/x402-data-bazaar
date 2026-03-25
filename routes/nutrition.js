const fetch = require("node-fetch");
const { Router } = require("express");
const router = Router();

router.get("/api/nutrition/search", async (req, res) => {
  try {
    const query = String(req.query.query ?? "chicken breast");
    const { limit } = req.query;

    const apiKey = process.env.USDA_API_KEY;
    if (!apiKey) return res.status(503).json({ success: false, error: "USDA API key not configured" });

    const pageSize = Math.min(parseInt(limit) || 5, 25);
    const resp = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${apiKey}&query=${encodeURIComponent(query)}&pageSize=${pageSize}&dataType=Survey (FNDDS),SR Legacy`
    );
    const raw = await resp.json();

    const foods = (raw.foods || []).map((f) => {
      const nutrients = {};
      for (const n of f.foodNutrients || []) {
        if (n.nutrientName && n.value != null) {
          nutrients[n.nutrientName] = { value: n.value, unit: n.unitName };
        }
      }
      return {
        id: f.fdcId,
        description: f.description,
        dataType: f.dataType,
        calories: nutrients["Energy"] || null,
        protein: nutrients["Protein"] || null,
        fat: nutrients["Total lipid (fat)"] || null,
        carbs: nutrients["Carbohydrate, by difference"] || null,
        fiber: nutrients["Fiber, total dietary"] || null,
        sugar: nutrients["Sugars, total including NLEA"] || null,
        sodium: nutrients["Sodium, Na"] || null,
        cholesterol: nutrients["Cholesterol"] || null,
      };
    });

    res.json({
      success: true,
      data: {
        query,
        totalHits: raw.totalHits,
        count: foods.length,
        foods,
      },
      source: "USDA FoodData Central",
    });
  } catch (err) {
    res.status(502).json({ success: false, error: "Upstream API error", details: err.message });
  }
});

module.exports = router;
