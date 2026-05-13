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
  buildAddressFromArgs,
  buildEntityData,
  buildSupplierUpdateData,
  searchSchemaProperties,
  entitySchemaProperties,
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
    description: "Create a new supplier record",
    inputSchema: {
      type: "object",
      properties: entitySchemaProperties,
      required: [],
    },
  },
  {
    name: "quickfile_supplier_update",
    description: "Update an existing supplier record",
    inputSchema: {
      type: "object",
      properties: {
        supplierId: {
          type: "number",
          description: "The supplier ID to update",
        },
        ...entitySchemaProperties,
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

// Supplier_Update response shape. The endpoint is not documented in the public
// QuickFile API reference but is functional. It returns SupplierDetailsUpdated
// as a boolean; observed live values are unreliable (false even on a successful
// update verified by a follow-up Supplier_Get), so the handler does not surface
// it to callers.
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
        const address = buildAddressFromArgs(args);
        const supplierData = buildEntityData(args, address);
        const cleanData = cleanParams(supplierData);
        const response = await apiClient.request<
          { SupplierData: typeof cleanData },
          SupplierCreateResponse
        >("Supplier_Create", { SupplierData: cleanData });
        return successResult({
          success: true,
          supplierId: response.SupplierID,
          message: `Supplier created successfully with ID ${response.SupplierID}`,
        });
      }

      case "quickfile_supplier_update": {
        // Notes on the wire format (verified live against the QuickFile API,
        // none of which are in the public method reference):
        // - The endpoint URL is /1_2/supplier/update.
        // - The request wraps the supplier in Body.SupplierDetails — note this
        //   is NOT symmetric with Supplier_Create (which uses Body.SupplierData)
        //   nor with Client_Update (which uses Body.ClientData).
        // - Contact fields use the Contact-prefixed names (ContactEmail,
        //   ContactFirstName, …) matching Supplier_Get and Supplier_Search,
        //   built by buildSupplierUpdateData (utils.ts).
        const supplierId = args.supplierId as number;
        const address = buildAddressFromArgs(args);
        const entityData = buildSupplierUpdateData(args, address);
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
