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
  buildSupplierCreateData,
  buildSupplierUpdateData,
  supplierEntitySchemaProperties,
  type ToolResult,
} from "./utils.js";

// =============================================================================
// Tool Definitions
// =============================================================================

export const supplierTools: Tool[] = [
  {
    name: "quickfile_supplier_search",
    description:
      "Search for suppliers by company name, contact first/last name, contact email, telephone, supplier reference, or postcode. Response contains user-controlled fields (CompanyName, contact names) that are automatically sanitized.",
    inputSchema: {
      type: "object",
      properties: {
        companyName: {
          type: "string",
          description: "Search by company name (partial match)",
        },
        firstName: {
          type: "string",
          description: "Search by contact first name",
        },
        lastName: {
          type: "string",
          description: "Search by contact surname",
        },
        email: {
          type: "string",
          description: "Search by contact email address",
        },
        telephone: {
          type: "string",
          description: "Search by contact telephone number",
        },
        supplierReference: {
          type: "string",
          description: "Search by supplier reference",
        },
        postcode: {
          type: "string",
          description: "Search by postcode",
        },
        showDeleted: {
          type: "boolean",
          description: "Include deleted suppliers in results",
        },
        returnCount: {
          type: "number",
          description: "Number of results (default: 25)",
          default: 25,
        },
        offset: {
          type: "number",
          description: "Offset for pagination",
          default: 0,
        },
        orderBy: {
          type: "string",
          enum: ["CompanyName", "DateCreated", "SupplierID"],
          description: "Field to order by",
        },
        orderDirection: {
          type: "string",
          enum: ["ASC", "DESC"],
          description: "Order direction",
        },
      },
      required: [],
    },
  },
  {
    name: "quickfile_supplier_get",
    description:
      "Get detailed information about a specific supplier. Response contains user-controlled fields (CompanyName, contact names, address) that are automatically sanitized.",
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
      "Create a new supplier record. Requires at minimum a companyName. The supplier endpoints reject several fields that the client endpoints accept (title, mobile, notes, county) — see the wire-shape table in utils.ts for the full list.",
    inputSchema: {
      type: "object",
      properties: supplierEntitySchemaProperties,
      required: ["companyName"],
    },
  },
  {
    name: "quickfile_supplier_update",
    description:
      "Update an existing supplier record. All fields except supplierId are optional and only supplied fields are sent on the wire (partial update).",
    inputSchema: {
      type: "object",
      properties: {
        supplierId: {
          type: "number",
          description: "The supplier ID to update",
        },
        ...supplierEntitySchemaProperties,
      },
      required: ["supplierId"],
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

// Supplier_Update response shape. Schema: api.quickfile.co.uk/d/v1_2/Supplier_Update.
// The endpoint returns SupplierDetailsUpdated as a boolean, but observed live
// values are unreliable (false even on a successful update verified by a
// follow-up Supplier_Get), so the handler does not surface it to callers.
interface SupplierUpdateResponse {
  SupplierDetailsUpdated?: boolean;
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
        // Supplier_Search uses ContactEmail / ContactFirstName / ContactSurname
        // / ContactTel — NOT the bare Email / FirstName / Surname / Telephone
        // names that Client_Search uses. The contactName arg the old schema
        // exposed isn't a real wire field on either endpoint, so callers now
        // pass firstName and lastName separately.
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
          ContactFirstName: args.firstName as string | undefined,
          ContactSurname: args.lastName as string | undefined,
          ContactEmail: args.email as string | undefined,
          ContactTel: args.telephone as string | undefined,
          SupplierReference: args.supplierReference as string | undefined,
          Postcode: args.postcode as string | undefined,
          ShowDeleted: args.showDeleted as boolean | undefined,
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
        // Wire wrapper is SupplierDetails (NOT SupplierData — that wraps
        // Client_Create). Address fields are flat children of SupplierDetails
        // and contact fields use Contact-prefixed names with `ContactSurname`
        // (lowercase n — diverges from Supplier_Update which uses ContactSurName).
        // Defaults for currency / payment terms are nested in a Preferences
        // block. Full wire-shape table near buildSupplierCreateData in utils.ts.
        const supplierData = buildSupplierCreateData(args);
        const cleanData = cleanParams(supplierData);
        const response = await apiClient.request<
          { SupplierDetails: typeof cleanData },
          SupplierCreateResponse
        >("Supplier_Create", { SupplierDetails: cleanData });
        return successResult({
          success: true,
          supplierId: response.SupplierID,
          message: `Supplier created successfully with ID ${response.SupplierID}`,
        });
      }

      case "quickfile_supplier_update": {
        // Wire wrapper is SupplierDetails (same as Supplier_Create). Contact
        // surname uses CAPITAL N (`ContactSurName`) — Supplier_Update and
        // Supplier_Create diverge on this one field name. See the wire-format
        // anchor near buildSupplierUpdateData in utils.ts.
        const supplierId = args.supplierId as number;
        const entityData = buildSupplierUpdateData(args);
        const updateData = { SupplierID: supplierId, ...entityData };
        const cleanData = cleanParams(updateData);
        await apiClient.request<
          { SupplierDetails: typeof cleanData },
          SupplierUpdateResponse
        >("Supplier_Update", { SupplierDetails: cleanData });
        return successResult({
          success: true,
          supplierId,
          message: `Supplier #${supplierId} updated successfully`,
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
