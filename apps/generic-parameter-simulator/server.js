const { createApp, sellerConfig } = require("./app");

const port = Number(process.env.PORT || sellerConfig.port || 4020);
const app = createApp();

app.listen(port, () => {
  console.log(`${sellerConfig.serviceName} running on port ${port}`);
});
