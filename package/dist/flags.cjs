"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/flags.ts
var flags_exports = {};
__export(flags_exports, {
  DEFAULT_COMPAT_MODE: () => DEFAULT_COMPAT_MODE,
  LEGACY_SUNSET_DATE: () => LEGACY_SUNSET_DATE,
  STRICT_ESCALATION_CODES: () => STRICT_ESCALATION_CODES
});
module.exports = __toCommonJS(flags_exports);
var LEGACY_SUNSET_DATE = "2026-03-24";
var DEFAULT_COMPAT_MODE = "on";
var STRICT_ESCALATION_CODES = [
  "LEGACY_WELL_KNOWN_USED",
  "LEGACY_DNS_USED",
  "LEGACY_DNS_PLAIN_URL",
  "LEGACY_MISSING_METHOD",
  "LEGACY_INSTRUCTIONS_USED",
  "LEGACY_OWNERSHIP_PROOFS_USED",
  "INTEROP_MPP_USED"
];
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_COMPAT_MODE,
  LEGACY_SUNSET_DATE,
  STRICT_ESCALATION_CODES
});
