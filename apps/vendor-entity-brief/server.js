const { createApp } = require("./app");
const { sellerConfig } = require("./app");

const port = Number(process.env.PORT || sellerConfig.port || 3000);
const app = createApp();

app.listen(port, () => {
  console.log(`${sellerConfig.serviceName} running on port ${port}`);
});
