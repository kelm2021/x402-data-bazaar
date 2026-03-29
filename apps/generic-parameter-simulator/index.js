const appModule = require("./app");

const app = appModule.createApp();

module.exports = app;
module.exports.createApp = appModule.createApp;
module.exports.createApiDiscoveryHandler = appModule.createApiDiscoveryHandler;
module.exports.createHealthHandler = appModule.createHealthHandler;
module.exports.createPaymentGate = appModule.createPaymentGate;
module.exports.createPaymentResourceServer = appModule.createPaymentResourceServer;
module.exports.createPaymentsMcpIntegration = appModule.createPaymentsMcpIntegration;
module.exports.createPaymentsMcpIntegrationHandler = appModule.createPaymentsMcpIntegrationHandler;
module.exports.createRouteConfig = appModule.createRouteConfig;
module.exports.loadFacilitator = appModule.loadFacilitator;
module.exports.loadCoinbaseFacilitator = appModule.loadCoinbaseFacilitator;
module.exports.PAY_TO = appModule.PAY_TO;
module.exports.X402_NETWORK = appModule.X402_NETWORK;
module.exports.CANONICAL_BASE_URL = appModule.CANONICAL_BASE_URL;
module.exports.routeConfig = appModule.routeConfig;
module.exports.sellerConfig = appModule.sellerConfig;
module.exports.normalizeEnvValue = appModule.normalizeEnvValue;
module.exports.normalizePrivateKey = appModule.normalizePrivateKey;
module.exports.simulationRequestSchema = appModule.simulationRequestSchema;
module.exports.parseSimParams = appModule.parseSimParams;
