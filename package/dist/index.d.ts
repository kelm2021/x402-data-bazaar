import { ResultAsync } from 'neverthrow';
import { CompatibilityMode } from './flags.js';

type TrustTier = 'unverified' | 'origin_hosted' | 'ownership_verified' | 'runtime_verified';
type AuthMode = 'paid' | 'siwx' | 'apiKey' | 'apiKey+paid' | 'unprotected';
type PricingMode = 'fixed' | 'range' | 'quote';
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS' | 'TRACE';

interface MppPaymentOption {
    protocol: 'mpp';
    /** Payment method identifier, e.g. "tempo" (Tempo protocol). */
    paymentMethod: string;
    /** Payment intent type, e.g. "charge". */
    intent: string;
    /** Server protection realm. */
    realm: string;
    /** CAIP-2 style network identifier, e.g. "tempo:4217". */
    network: string;
    /** Currency / token contract. */
    asset: string;
    /** Raw token-unit amount string. */
    amount: string;
    /** Token decimal places, used for display conversion. */
    decimals?: number;
    /** Recipient address. */
    payTo?: string;
    /** Human-readable description of the resource. */
    description?: string;
}

interface X402V1PaymentOption {
    protocol: 'x402';
    version: 1;
    /** Payment scheme, e.g. "exact". */
    scheme?: string;
    /** CAIP-2 network identifier, e.g. "eip155:8453". */
    network: string;
    /** Token contract address. */
    asset: string;
    /** Upper-bound token-unit amount string (v1 semantics). */
    maxAmountRequired: string;
    /** Recipient wallet address. */
    payTo?: string;
    maxTimeoutSeconds?: number;
}
interface X402V2PaymentOption {
    protocol: 'x402';
    version: 2;
    /** Payment scheme, e.g. "exact". */
    scheme?: string;
    /** CAIP-2 network identifier, e.g. "eip155:8453". */
    network: string;
    /** Token contract address. */
    asset: string;
    /** Exact token-unit amount string (v2 semantics). */
    amount: string;
    /** Recipient wallet address. */
    payTo?: string;
    maxTimeoutSeconds?: number;
}
type X402PaymentOption = X402V1PaymentOption | X402V2PaymentOption;
type PaymentOption = X402PaymentOption | MppPaymentOption;
interface PricingHint {
    pricingMode: PricingMode | string;
    price?: string;
    minPrice?: string;
    maxPrice?: string;
}
interface OpenApiSource {
    raw: Record<string, unknown>;
    info: {
        title: string;
        description?: string;
        version: string;
    };
    routes: OpenApiRoute[];
    guidance?: string;
    fetchedUrl: string;
}
/** Returned when the spec was fetched successfully but failed schema validation. */
interface OpenApiParseFailure {
    parseFailure: true;
    fetchedUrl: string;
    issues: Array<{
        path: (string | number | symbol)[];
        message: string;
    }>;
}
interface OpenApiRoute {
    path: string;
    method: HttpMethod;
    summary?: string;
    authMode?: AuthMode;
    protocols?: string[];
    pricing?: PricingHint;
}
interface WellKnownSource {
    raw: Record<string, unknown>;
    routes: WellKnownRoute[];
    title?: string;
    description?: string;
    instructions?: string;
    fetchedUrl: string;
    /** Which well-known document(s) this source was built from. */
    protocol: 'x402' | 'mpp' | 'x402+mpp';
}
interface WellKnownRoute {
    path: string;
    method: HttpMethod;
    /** Raw price hint from the well-known document (e.g. MPP `payment.amount`). */
    price?: string;
}
interface ProbeResult {
    path: string;
    method: HttpMethod;
    authHint: AuthMode;
    protocols?: string[];
    /** Raw 402 response body, present when the endpoint returned a payment challenge. */
    paymentRequiredBody?: unknown;
    /** Raw WWW-Authenticate header value from the 402 response. */
    wwwAuthenticate?: string;
}
interface L2Result {
    title?: string;
    description?: string;
    version?: string;
    routes: L2Route[];
    source: 'openapi' | 'well-known/x402' | 'well-known/mpp' | 'well-known/x402+mpp' | null;
}
interface L2Route {
    path: string;
    method: HttpMethod;
    summary: string;
    authMode?: AuthMode;
    price?: string;
    pricingMode?: string;
    protocols?: string[];
}
interface L3Result {
    source: 'openapi' | 'probe';
    summary?: string;
    authMode?: AuthMode;
    estimatedPrice?: string;
    protocols?: string[];
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    /** Live payment options parsed from the 402 response. Only present on probe results. */
    paymentOptions?: PaymentOption[];
    /**
     * Raw 402 response body captured during probing. Present when the endpoint was probed
     * and returned a 402. Used by getWarningsForL3 to run full payment-required validation.
     */
    paymentRequiredBody?: unknown;
    /**
     * Raw WWW-Authenticate header value from the 402 response. Present when the endpoint
     * was probed and returned a 402 with an MPP challenge. Used by getWarningsForMppHeader.
     */
    wwwAuthenticate?: string;
}
interface L4Result {
    guidance: string;
    source: 'openapi' | 'well-known/x402' | 'well-known/mpp' | 'well-known/x402+mpp';
}

declare enum GuidanceMode {
    /** Include guidance only when under the auto-include threshold (default). */
    Auto = "auto",
    /** Always include guidance, even if large. */
    Always = "always",
    /** Never include guidance; return discovery data only. */
    Never = "never"
}
interface DiscoverOriginSchemaOptions {
    target: string;
    guidance?: GuidanceMode;
    specificationOverrideUrl?: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
}
interface DiscoverOriginSchemaSuccess {
    found: true;
    origin: string;
    /** Which discovery context source produced the endpoint list (e.g. `"openapi"`). */
    source: string;
    /** Metadata from the OpenAPI `info` block, when available. */
    info?: {
        title: string;
        description?: string;
        version?: string;
    };
    /** Discovered endpoints with advisory pricing and auth metadata. */
    endpoints: L2Route[];
    /** True when guidance text exists for this API. */
    guidanceAvailable: boolean;
    /** Estimated token count of the guidance text. Present when guidanceAvailable is true. */
    guidanceTokens?: number;
    /** Guidance text. Included when short enough (auto mode) or guidance='always'. */
    guidance?: string;
    /** Ownership proof strings collected from the discovery document, if any. */
    ownershipProofs?: string[];
}
interface DiscoverOriginSchemaNotFound {
    found: false;
    origin: string;
    cause: 'not_found' | 'network' | 'timeout';
    message?: string;
}
type DiscoverOriginSchemaResult = DiscoverOriginSchemaSuccess | DiscoverOriginSchemaNotFound;
interface CheckEndpointOptions {
    /** Full endpoint URL (e.g. `"https://api.example.com/pay"`). */
    url: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    /** Sample input body for the endpoint.
     *
     * Providing this will cause the endpoint to always be probed, and will return the exact
     * PaymentOptions that would be returned by the live 402 response.
     *
     * The agent will use this to get an exact price quote for the body they are planning on sending
     * with fetch.
     *
     */
    sampleInputBody?: Record<string, unknown>;
    /**
     * When true, skips OpenAPI lookup and probes the live endpoint directly.
     * Use this to retrieve actual PaymentOptions (realm, payTo, network, asset, amount)
     * from the 402 response rather than static OpenAPI metadata.
     */
    probe?: boolean;
}
interface EndpointMethodAdvisory extends L3Result {
    method: HttpMethod;
}
interface CheckEndpointSuccess {
    found: true;
    origin: string;
    path: string;
    advisories: EndpointMethodAdvisory[];
}
interface CheckEndpointNotFound {
    found: false;
    origin: string;
    path: string;
    cause: 'not_found' | 'network' | 'timeout';
    message?: string;
}
type CheckEndpointResult = CheckEndpointSuccess | CheckEndpointNotFound;

declare function discoverOriginSchema(options: DiscoverOriginSchemaOptions): Promise<DiscoverOriginSchemaResult>;

declare function checkEndpointSchema(options: CheckEndpointOptions): Promise<CheckEndpointResult>;

interface FetchError {
    cause: 'network' | 'timeout';
    message: string;
}

declare function getOpenAPI(origin: string, headers?: Record<string, string>, signal?: AbortSignal, specificationOverrideUrl?: string): ResultAsync<OpenApiSource | OpenApiParseFailure | null, FetchError>;

/**
 * Fetches both `/.well-known/x402` and `/.well-known/mpp` in parallel and merges results.
 *
 * In practice these are mutually exclusive, but if both exist their routes are combined
 * (deduplicated by method+path). x402 wins on instruction/fetchedUrl conflicts.
 *
 * Individual leg failures are treated as "not found" for that leg so valid data from
 * the other is never suppressed. Returns Err(FetchError) only when both legs hard-fail.
 */
declare function getWellKnown(origin: string, headers?: Record<string, string>, signal?: AbortSignal): ResultAsync<WellKnownSource | null, FetchError>;

declare function getX402WellKnown(origin: string, headers?: Record<string, string>, signal?: AbortSignal): ResultAsync<WellKnownSource | null, FetchError>;

declare function getMppWellKnown(origin: string, headers?: Record<string, string>, signal?: AbortSignal): ResultAsync<WellKnownSource | null, FetchError>;

declare function getProbe(url: string, headers?: Record<string, string>, signal?: AbortSignal, inputBody?: Record<string, unknown>): ResultAsync<ProbeResult[], FetchError>;

declare function checkL2ForOpenAPI(openApi: OpenApiSource): L2Result;
declare function checkL2ForWellknown(wellKnown: WellKnownSource): L2Result;

declare function getL3ForOpenAPI(openApi: OpenApiSource, path: string, method: HttpMethod): L3Result | null;
declare function getL3ForProbe(probe: ProbeResult[], path: string, method: HttpMethod, openApi?: OpenApiSource | null): L3Result | null;
/**
 * Probes `url` and populates `paymentRequiredBody` on each advisory so that
 * getWarningsForL3 can run full 402-body validation. Mutates in place; no-ops on network error.
 */
declare function attachProbePayload(url: string, advisories: Array<L3Result & {
    method: HttpMethod;
}>): Promise<void>;
declare function getL3(openApi: OpenApiSource | null, probe: ProbeResult[], path: string, method: HttpMethod): L3Result | null;

declare function checkL4ForOpenAPI(openApi: OpenApiSource): L4Result | null;
declare function checkL4ForWellknown(wellKnown: WellKnownSource): L4Result | null;

declare const VALIDATION_CODES: {
    readonly COINBASE_SCHEMA_INVALID: "COINBASE_SCHEMA_INVALID";
    readonly X402_NOT_OBJECT: "X402_NOT_OBJECT";
    readonly X402_VERSION_MISSING: "X402_VERSION_MISSING";
    readonly X402_VERSION_UNSUPPORTED: "X402_VERSION_UNSUPPORTED";
    readonly X402_VERSION_V1_NOT_SUPPORTED: "X402_VERSION_V1_NOT_SUPPORTED";
    readonly X402_ACCEPTS_MISSING: "X402_ACCEPTS_MISSING";
    readonly X402_ACCEPTS_INVALID: "X402_ACCEPTS_INVALID";
    readonly X402_ACCEPTS_EMPTY: "X402_ACCEPTS_EMPTY";
    readonly X402_ACCEPT_ENTRY_INVALID: "X402_ACCEPT_ENTRY_INVALID";
    readonly NETWORK_CAIP2_INVALID: "NETWORK_CAIP2_INVALID";
    readonly NETWORK_EIP155_REFERENCE_INVALID: "NETWORK_EIP155_REFERENCE_INVALID";
    readonly NETWORK_SOLANA_ALIAS_INVALID: "NETWORK_SOLANA_ALIAS_INVALID";
    readonly NETWORK_SOLANA_ALIAS_COMPAT: "NETWORK_SOLANA_ALIAS_COMPAT";
    readonly NETWORK_REFERENCE_UNKNOWN: "NETWORK_REFERENCE_UNKNOWN";
    readonly SCHEMA_INPUT_MISSING: "SCHEMA_INPUT_MISSING";
    readonly SCHEMA_OUTPUT_MISSING: "SCHEMA_OUTPUT_MISSING";
    readonly METADATA_TITLE_MISSING: "METADATA_TITLE_MISSING";
    readonly METADATA_DESCRIPTION_MISSING: "METADATA_DESCRIPTION_MISSING";
    readonly METADATA_FAVICON_MISSING: "METADATA_FAVICON_MISSING";
    readonly METADATA_OG_IMAGE_MISSING: "METADATA_OG_IMAGE_MISSING";
};

type ValidationSeverity = 'error' | 'warn' | 'info';
type ValidationStage = 'payment_required' | 'openapi' | 'metadata' | 'compat' | 'runtime_probe';
interface ValidationIssue {
    code: string;
    severity: ValidationSeverity;
    message: string;
    hint?: string;
    path?: string;
    expected?: string;
    actual?: string;
    docsUrl?: string;
    stage: ValidationStage;
}
interface MetadataPreview {
    title?: string | null;
    description?: string | null;
    favicon?: string | null;
    ogImages?: Array<{
        url?: string | null;
    } | string> | null;
}
interface NormalizedAccept {
    index: number;
    network: string;
    networkRaw: string;
    scheme?: string;
    asset?: string;
    payTo?: string;
    amount?: string;
    maxTimeoutSeconds?: number;
}
interface NormalizedPaymentRequired {
    version: 1 | 2;
    accepts: NormalizedAccept[];
    hasInputSchema: boolean;
    hasOutputSchema: boolean;
}
interface ValidatePaymentRequiredOptions {
    compatMode?: CompatibilityMode;
    requireInputSchema?: boolean;
    requireOutputSchema?: boolean;
    metadata?: MetadataPreview;
}
interface ValidationSummary {
    errorCount: number;
    warnCount: number;
    infoCount: number;
    byCode: Record<string, number>;
}
interface ValidatePaymentRequiredDetailedResult {
    valid: boolean;
    version?: 1 | 2;
    parsed?: Record<string, unknown>;
    normalized?: NormalizedPaymentRequired;
    issues: ValidationIssue[];
    summary: ValidationSummary;
}

declare function evaluateMetadataCompleteness(metadata: MetadataPreview): ValidationIssue[];

/**
 * Validates a 402 response body. Delegates to getWarningsFor402Body (the canonical
 * audit function) and reconstructs the full typed result shape for backwards compatibility.
 */
declare function validatePaymentRequiredDetailed(payload: unknown, options?: ValidatePaymentRequiredOptions): ValidatePaymentRequiredDetailedResult;

declare const AUDIT_CODES: {
    readonly OPENAPI_NOT_FOUND: "OPENAPI_NOT_FOUND";
    readonly WELLKNOWN_NOT_FOUND: "WELLKNOWN_NOT_FOUND";
    readonly OPENAPI_PARSE_ERROR: "OPENAPI_PARSE_ERROR";
    readonly OPENAPI_NO_ROUTES: "OPENAPI_NO_ROUTES";
    readonly L2_NO_ROUTES: "L2_NO_ROUTES";
    readonly L2_ROUTE_COUNT_HIGH: "L2_ROUTE_COUNT_HIGH";
    readonly L2_AUTH_MODE_MISSING: "L2_AUTH_MODE_MISSING";
    readonly L2_NO_PAID_ROUTES: "L2_NO_PAID_ROUTES";
    readonly L2_PRICE_MISSING_ON_PAID: "L2_PRICE_MISSING_ON_PAID";
    readonly L2_PRICING_MODE_UNKNOWN: "L2_PRICING_MODE_UNKNOWN";
    readonly L2_PROTOCOLS_MISSING_ON_PAID: "L2_PROTOCOLS_MISSING_ON_PAID";
    readonly L3_NOT_FOUND: "L3_NOT_FOUND";
    readonly L3_INPUT_SCHEMA_MISSING: "L3_INPUT_SCHEMA_MISSING";
    readonly L3_AUTH_MODE_MISSING: "L3_AUTH_MODE_MISSING";
    readonly L3_PROTOCOLS_MISSING_ON_PAID: "L3_PROTOCOLS_MISSING_ON_PAID";
    readonly L3_PAYMENT_OPTIONS_MISSING_ON_PAID: "L3_PAYMENT_OPTIONS_MISSING_ON_PAID";
    readonly L4_GUIDANCE_MISSING: "L4_GUIDANCE_MISSING";
    readonly L4_GUIDANCE_TOO_LONG: "L4_GUIDANCE_TOO_LONG";
    readonly MPP_HEADER_MISSING: "MPP_HEADER_MISSING";
    readonly MPP_NO_PAYMENT_CHALLENGES: "MPP_NO_PAYMENT_CHALLENGES";
    readonly MPP_CHALLENGE_ID_MISSING: "MPP_CHALLENGE_ID_MISSING";
    readonly MPP_CHALLENGE_METHOD_MISSING: "MPP_CHALLENGE_METHOD_MISSING";
    readonly MPP_CHALLENGE_INTENT_MISSING: "MPP_CHALLENGE_INTENT_MISSING";
    readonly MPP_CHALLENGE_REALM_MISSING: "MPP_CHALLENGE_REALM_MISSING";
    readonly MPP_CHALLENGE_EXPIRES_MISSING: "MPP_CHALLENGE_EXPIRES_MISSING";
    readonly MPP_CHALLENGE_REQUEST_MISSING: "MPP_CHALLENGE_REQUEST_MISSING";
    readonly MPP_CHALLENGE_REQUEST_INVALID: "MPP_CHALLENGE_REQUEST_INVALID";
    readonly MPP_CHALLENGE_ASSET_MISSING: "MPP_CHALLENGE_ASSET_MISSING";
    readonly MPP_CHALLENGE_AMOUNT_MISSING: "MPP_CHALLENGE_AMOUNT_MISSING";
    readonly MPP_CHALLENGE_RECIPIENT_MISSING: "MPP_CHALLENGE_RECIPIENT_MISSING";
    readonly FAVICON_MISSING: "FAVICON_MISSING";
};
type AuditCode = (typeof AUDIT_CODES)[keyof typeof AUDIT_CODES];

type AuditSeverity = 'error' | 'warn' | 'info';
interface AuditWarning {
    code: string;
    severity: AuditSeverity;
    message: string;
    hint?: string;
    /** Dotted path to the field this warning refers to, when applicable. */
    path?: string;
}

/** Type guard: true when the value is a parse-failure sentinel (spec fetched but invalid). */
declare function isOpenApiParseFailure(value: OpenApiSource | OpenApiParseFailure | null): value is OpenApiParseFailure;
declare function getWarningsForOpenAPI(openApi: OpenApiSource | OpenApiParseFailure | null): AuditWarning[];
declare function getWarningsForWellKnown(wellKnown: WellKnownSource | null): AuditWarning[];

declare function getWarningsForL2(l2: L2Result): AuditWarning[];

/**
 * Validates a raw 402 response body and returns issues as AuditWarnings.
 * Uses the v1/v2 protocol validators directly — the canonical source of truth
 * for 402 body quality checks. x402scan should call this instead of
 * validatePaymentRequiredDetailed.
 */
declare function getWarningsFor402Body(body: unknown): AuditWarning[];
declare function getWarningsForL3(l3: L3Result | null): AuditWarning[];

declare function getWarningsForL4(l4: L4Result | null): AuditWarning[];

/**
 * Validates a raw WWW-Authenticate header value from an MPP 402 response and
 * returns issues as AuditWarnings.
 *
 * Checks for:
 * - Header presence
 * - At least one Payment challenge
 * - Required challenge parameters: id, method, intent, realm, expires, request
 * - Valid base64url-encoded JSON in the request field
 * - Required request fields: currency (asset), amount
 * - Recommended request field: recipient (payTo)
 */
declare function getWarningsForMppHeader(wwwAuthenticate: string | null | undefined): AuditWarning[];

declare function checkFavicon(origin: string): ResultAsync<boolean, never>;
declare function getWarningsForFavicon(origin: string): ResultAsync<AuditWarning[], never>;

export { AUDIT_CODES, type AuditCode, type AuditSeverity, type AuditWarning, type AuthMode, type CheckEndpointNotFound, type CheckEndpointOptions, type CheckEndpointResult, type CheckEndpointSuccess, type DiscoverOriginSchemaNotFound, type DiscoverOriginSchemaOptions, type DiscoverOriginSchemaResult, type DiscoverOriginSchemaSuccess, type EndpointMethodAdvisory, GuidanceMode, type HttpMethod, type L2Result, type L2Route, type L3Result, type L4Result, type MetadataPreview, type MppPaymentOption, type NormalizedAccept, type NormalizedPaymentRequired, type OpenApiParseFailure, type OpenApiRoute, type OpenApiSource, type PaymentOption, type PricingMode, type ProbeResult, type TrustTier, VALIDATION_CODES, type ValidatePaymentRequiredDetailedResult, type ValidatePaymentRequiredOptions, type ValidationIssue, type ValidationSeverity, type ValidationStage, type ValidationSummary, type WellKnownRoute, type WellKnownSource, type X402PaymentOption, type X402V1PaymentOption, type X402V2PaymentOption, attachProbePayload, checkEndpointSchema, checkFavicon, checkL2ForOpenAPI, checkL2ForWellknown, checkL4ForOpenAPI, checkL4ForWellknown, discoverOriginSchema, evaluateMetadataCompleteness, getL3, getL3ForOpenAPI, getL3ForProbe, getMppWellKnown, getOpenAPI, getProbe, getWarningsFor402Body, getWarningsForFavicon, getWarningsForL2, getWarningsForL3, getWarningsForL4, getWarningsForMppHeader, getWarningsForOpenAPI, getWarningsForWellKnown, getWellKnown, getX402WellKnown, isOpenApiParseFailure, validatePaymentRequiredDetailed };
