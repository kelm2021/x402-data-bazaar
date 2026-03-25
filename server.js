const app = require("./index");

const PORT = process.env.PORT || 4402;

app.listen(PORT, () => {
  console.log(`x402 Data Bazaar running on port ${PORT}`);
});
