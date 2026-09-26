/**
 * QuickFile Supplier Tools
 * Supplier management operations
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getApiClient } from "../api/client.js";
import type { Supplier, SupplierSearchParams } from "../types/quickfile.js";
import {
  handleToolError,
  successResult,
  errorResult,
  cleanParams,
  searchSchemaProperties,
  type ToolResult,
} from "./utils.js";

// =============================================================================
// Tool Definitions
// =============================================================================

export const supplierTools: Tool[] = [
  {
    name: "quickfile_supplier_search",
    description:
      "Search for suppliers by company name, contact name, email, or postcode. Response contains user-controlled fields (CompanyName, contact names) that are automatically sanitized.",
    inputSchema: {
      type: "object",
      properties: {
        ...searchSchemaProperties,
        orderBy: {
          type: "string",
          enum: ["CompanyName", "DateCreated", "SupplierID"],
          description: "Field to order by",
        },
      },
      required: [],
    },
  },
  {
    name: "quickfile_supplier_get",
    description:
      "Get detailed information about a specific supplier. Response contains user-controlled fields (CompanyName, Notes, Address, contact names) that are automatically sanitized.",
    inputSchema: {
      type: "object",
      properties: {
        supplierId: { type: "number", description: "The supplier ID" },
      },
      required: ["supplierId"],
    },
  },
  {
    name: "quickfile_supplier_create",
    description:
      "Create a new supplier record. QuickFile's supplier record has no notes, title, mobile or county fields, so those are not accepted here.",
    inputSchema: {
      type: "object",
      properties: supplierCreateSchemaProperties(),
      required: ["companyName"],
    },
  },
  {
    name: "quickfile_supplier_delete",
    description: "Delete a supplier record (use with caution)",
    inputSchema: {
      type: "object",
      properties: {
        supplierId: {
          type: "number",
          description: "The supplier ID to delete",
        },
      },
      required: ["supplierId"],
    },
  },
];

// =============================================================================
// Supplier_Create payload
// =============================================================================

/**
 * Supplier_Create's `SupplierDetails` is a flat element with its own names,
 * not the Client_Create shape: `ContactEmail` rather than `Email`,
 * `AddressLine1..3` rather than a nested `Address`, currency and terms under
 * `Preferences`, and a mandatory `CountryISO`. Reusing the client mapping
 * sent fields the API's schema rejects, so every create failed.
 */
function supplierCreateSchemaProperties() {
  const str = (description: string) => ({
    type: "string" as const,
    description,
  });
  return {
    companyName: str("Company or organisation name"),
    supplierReference: str(
      "Your own reference for the supplier (QuickFile assigns one if omitted)",
    ),
    firstName: str("Contact first name"),
    lastName: str("Contact surname"),
    email: str(
      "Contact email address (stored as the supplier's ContactEmail, which supplier search matches on)",
    ),
    telephone: str("Contact telephone number"),
    website: str("Website URL"),
    address1: str("Address line 1"),
    address2: str("Address line 2"),
    address3: str("Address line 3"),
    town: str("Town/City"),
    postcode: str("Postcode"),
    country: str(
      "Two-letter ISO 3166 country code, e.g. GB, IE, US (default: GB). 'UK' is accepted as GB.",
    ),
    vatNumber: str("VAT registration number"),
    companyRegNo: str("Company registration number"),
    currency: str("Default currency (e.g., GBP)"),
    termDays: {
      type: "number" as const,
      description: "Default payment terms in days",
    },
  };
}

/** Normalise a country argument to the ISO code Supplier_Create requires. */
export function toCountryIso(country: unknown): string {
  if (country === undefined || country === null || country === "") {
    return "GB";
  }
  const c = String(country).trim().toUpperCase();
  if (c === "UK" || c === "UNITED KINGDOM") {
    return "GB";
  }
  if (!/^[A-Z]{2}$/.test(c)) {
    throw new Error(
      `country must be a two-letter ISO code (e.g. GB), got "${String(country)}"`,
    );
  }
  return c;
}

export function buildSupplierDetails(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const s = (k: string) => args[k] as string | undefined;
  const preferences = cleanParams({
    DefaultCurrency: s("currency"),
    DefaultTerm: args.termDays as number | undefined,
  });
  return cleanParams({
    CompanyName: s("companyName"),
    SupplierReference: s("supplierReference"),
    CompanyNumber: s("companyRegNo"),
    AddressLine1: s("address1"),
    AddressLine2: s("address2"),
    AddressLine3: s("address3"),
    Town: s("town"),
    Postcode: s("postcode"),
    CountryISO: toCountryIso(args.country),
    VatNumber: s("vatNumber"),
    Website: s("website"),
    ContactFirstName: s("firstName"),
    ContactSurname: s("lastName"),
    ContactEmail: s("email"),
    ContactTel: s("telephone"),
    Preferences: Object.keys(preferences).length > 0 ? preferences : undefined,
  });
}

// =============================================================================
// Tool Handlers
// =============================================================================

interface SupplierSearchResponse {
  RecordsetCount: number;
  ReturnCount: number;
  Record: Supplier[];
}

interface SupplierGetResponse {
  SupplierDetails: Supplier;
}

interface SupplierCreateResponse {
  SupplierID: number;
}

// =============================================================================
// Tool Handler
// =============================================================================

export async function handleSupplierTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const apiClient = getApiClient();

  try {
    switch (toolName) {
      case "quickfile_supplier_search": {
        const params: SupplierSearchParams = {
          OrderResultsBy:
            (args.orderBy as SupplierSearchParams["OrderResultsBy"]) ??
            "CompanyName",
          OrderDirection:
            (args.orderDirection as SupplierSearchParams["OrderDirection"]) ??
            "ASC",
          ReturnCount: (args.returnCount as number) ?? 25,
          Offset: (args.offset as number) ?? 0,
          CompanyName: args.companyName as string | undefined,
          ContactName: args.contactName as string | undefined,
          Email: args.email as string | undefined,
          Postcode: args.postcode as string | undefined,
        };
        const cleaned = cleanParams(params);
        const response = await apiClient.request<
          { SearchParameters: typeof cleaned },
          SupplierSearchResponse
        >("Supplier_Search", { SearchParameters: cleaned });
        const suppliers = response.Record || [];
        return successResult({
          totalRecords: response.RecordsetCount,
          count: suppliers.length,
          suppliers,
        });
      }

      case "quickfile_supplier_get": {
        const response = await apiClient.request<
          { SupplierID: number },
          SupplierGetResponse
        >("Supplier_Get", { SupplierID: args.supplierId as number });
        return successResult(response.SupplierDetails);
      }

      case "quickfile_supplier_create": {
        if (!args.companyName) {
          return errorResult("companyName is required");
        }
        const details = buildSupplierDetails(args);
        const response = await apiClient.request<
          { SupplierDetails: typeof details },
          SupplierCreateResponse
        >("Supplier_Create", { SupplierDetails: details });
        return successResult({
          success: true,
          supplierId: response.SupplierID,
          message: `Supplier created successfully with ID ${response.SupplierID}`,
        });
      }

      case "quickfile_supplier_delete": {
        await apiClient.request<{ SupplierID: number }, Record<string, never>>(
          "Supplier_Delete",
          { SupplierID: args.supplierId as number },
        );
        return successResult({
          success: true,
          supplierId: args.supplierId,
          message: `Supplier #${args.supplierId} deleted successfully`,
        });
      }

      default:
        return errorResult(`Unknown supplier tool: ${toolName}`);
    }
  } catch (error) {
    return handleToolError(error);
  }
}
