/**
 * Unit tests for supplier tools.
 */

import { handleSupplierTool, supplierTools } from "../../src/tools/supplier";
import { getApiClient } from "../../src/api/client";

jest.mock("../../src/api/client", () => ({
  getApiClient: jest.fn(),
  QuickFileApiError: class QuickFileApiError extends Error {
    constructor(
      message: string,
      public code: string,
    ) {
      super(message);
      this.name = "QuickFileApiError";
    }
  },
}));

describe("Supplier tools", () => {
  const mockRequest = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (getApiClient as jest.Mock).mockReturnValue({
      request: mockRequest,
    });
  });

  describe("quickfile_supplier_update", () => {
    it("declares supplierId as a required input", () => {
      const tool = supplierTools.find(
        (candidate) => candidate.name === "quickfile_supplier_update",
      );

      expect(tool?.inputSchema).toMatchObject({
        properties: {
          supplierId: { type: "number" },
        },
        required: ["supplierId"],
      });
    });

    it("wraps the payload in SupplierDetails (not SupplierData)", async () => {
      mockRequest.mockResolvedValueOnce({ SupplierDetailsUpdated: false });

      await handleSupplierTool("quickfile_supplier_update", {
        supplierId: 12345,
        email: "accounts@example.com",
      });

      expect(mockRequest).toHaveBeenCalledWith("Supplier_Update", {
        SupplierDetails: {
          SupplierID: 12345,
          ContactEmail: "accounts@example.com",
        },
      });
    });

    it("sends contact fields with the Contact-prefixed wire names", async () => {
      mockRequest.mockResolvedValueOnce({ SupplierDetailsUpdated: true });

      await handleSupplierTool("quickfile_supplier_update", {
        supplierId: 99,
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        telephone: "020 7946 0000",
        mobile: "07700 900123",
      });

      const [, payload] = mockRequest.mock.calls[0];
      expect(payload.SupplierDetails).toEqual({
        SupplierID: 99,
        ContactFirstName: "Ada",
        ContactSurname: "Lovelace",
        ContactEmail: "ada@example.com",
        ContactTelephone: "020 7946 0000",
        ContactMobile: "07700 900123",
      });
      // Negative assertions: the client-style bare field names must never appear
      // — the Supplier_Update endpoint silently ignores them.
      expect(payload.SupplierDetails).not.toHaveProperty("Email");
      expect(payload.SupplierDetails).not.toHaveProperty("FirstName");
      expect(payload.SupplierDetails).not.toHaveProperty("Surname");
      expect(payload.SupplierDetails).not.toHaveProperty("Telephone");
      expect(payload.SupplierDetails).not.toHaveProperty("Mobile");
    });

    it("omits undefined fields so it acts as a true partial update", async () => {
      mockRequest.mockResolvedValueOnce({ SupplierDetailsUpdated: false });

      await handleSupplierTool("quickfile_supplier_update", {
        supplierId: 42,
        email: "x@example.com",
      });

      const [, payload] = mockRequest.mock.calls[0];
      // Only the two fields the caller supplied; nothing else creeps in.
      expect(Object.keys(payload.SupplierDetails).sort()).toEqual([
        "ContactEmail",
        "SupplierID",
      ]);
    });

    it("returns a stable success result that does not expose the misleading SupplierDetailsUpdated boolean", async () => {
      // Live observation (2026-05-13): the QuickFile API returns
      // SupplierDetailsUpdated: false even after a successful update verified
      // by a follow-up Supplier_Get. The handler must not surface this flag.
      mockRequest.mockResolvedValueOnce({ SupplierDetailsUpdated: false });

      const result = await handleSupplierTool("quickfile_supplier_update", {
        supplierId: 7,
        email: "x@example.com",
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual({
        success: true,
        supplierId: 7,
        message: "Supplier #7 updated successfully",
      });
      expect(parsed).not.toHaveProperty("SupplierDetailsUpdated");
    });

    it("includes the address block only when at least one address field is provided", async () => {
      mockRequest.mockResolvedValueOnce({ SupplierDetailsUpdated: true });

      await handleSupplierTool("quickfile_supplier_update", {
        supplierId: 1,
        postcode: "TF9 4LA",
      });

      const [, withAddress] = mockRequest.mock.calls[0];
      expect(withAddress.SupplierDetails).toHaveProperty("Address", {
        Postcode: "TF9 4LA",
      });

      mockRequest.mockClear();
      mockRequest.mockResolvedValueOnce({ SupplierDetailsUpdated: true });

      await handleSupplierTool("quickfile_supplier_update", {
        supplierId: 1,
        email: "x@example.com",
      });

      const [, withoutAddress] = mockRequest.mock.calls[0];
      expect(withoutAddress.SupplierDetails).not.toHaveProperty("Address");
    });
  });
});
