const appModule = require("./app");

const app = appModule.createApp();

module.exports = app;
module.exports.createApp = appModule.createApp;
module.exports.createMetricsAttribution = appModule.createMetricsAttribution;
module.exports.createMetricsDashboardHandler = appModule.createMetricsDashboardHandler;
module.exports.createMetricsDataHandler = appModule.createMetricsDataHandler;
module.exports.createMetricsMiddleware = appModule.createMetricsMiddleware;
module.exports.createMetricsStore = appModule.createMetricsStore;
module.exports.createPaymentGate = appModule.createPaymentGate;
module.exports.createRouteCatalog = appModule.createRouteCatalog;
module.exports.createRouteConfig = appModule.createRouteConfig;
module.exports.loadCoinbaseFacilitator = appModule.loadCoinbaseFacilitator;
module.exports.PAY_TO = appModule.PAY_TO;
module.exports.X402_NETWORK = appModule.X402_NETWORK;
module.exports.routeConfig = appModule.routeConfig;
module.exports.sellerConfig = appModule.sellerConfig;
