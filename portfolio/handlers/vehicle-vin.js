const fetch = require("node-fetch");

module.exports = async function primaryHandler(req, res) {
  try {
    const { vin } = req.params;
    if (!vin || vin.length !== 17) {
      return res.status(400).json({
        success: false,
        error: "VIN must be exactly 17 characters",
      });
    }

    const response = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`,
    );
    const raw = await response.json();

    const fields = {};
    for (const result of raw.Results || []) {
      if (result.Value && result.Value.trim() !== "" && result.Variable) {
        fields[result.Variable] = result.Value.trim();
      }
    }

    res.json({
      success: true,
      data: {
        vin,
        year: fields["Model Year"] || null,
        make: fields["Make"] || null,
        model: fields["Model"] || null,
        trim: fields["Trim"] || null,
        bodyClass: fields["Body Class"] || null,
        driveType: fields["Drive Type"] || null,
        fuelType: fields["Fuel Type - Primary"] || null,
        engineCylinders: fields["Engine Number of Cylinders"] || null,
        engineDisplacement: fields["Displacement (L)"] || null,
        transmissionStyle: fields["Transmission Style"] || null,
        plantCountry: fields["Plant Country"] || null,
        vehicleType: fields["Vehicle Type"] || null,
      },
      source: "NHTSA vPIC API",
    });
  } catch (error) {
    res.status(502).json({
      success: false,
      error: "Upstream API error",
      details: error.message,
    });
  }
};
