/**
 * Unit tests for supplier tools.
 */

import { handleSupplierTool } from "../../src/tools/supplier";
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

  describe("quickfile_supplier_search", () => {
    it("maps the email argument to ContactEmail in the Supplier_Search wire schema", async () => {
      mockRequest.mockResolvedValueOnce({
        RecordsetCount: 0,
        ReturnCount: 0,
        Record: [],
      });

      await handleSupplierTool("quickfile_supplier_search", {
        email: "accounts@example.com",
      });

      expect(mockRequest).toHaveBeenCalledWith("Supplier_Search", {
        SearchParameters: {
          ReturnCount: 25,
          Offset: 0,
          OrderResultsBy: "CompanyName",
          OrderDirection: "ASC",
          ContactEmail: "accounts@example.com",
        },
      });
    });

    it("does not send a bare Email field that the Supplier_Search endpoint would silently ignore", async () => {
      mockRequest.mockResolvedValueOnce({
        RecordsetCount: 0,
        ReturnCount: 0,
        Record: [],
      });

      await handleSupplierTool("quickfile_supplier_search", {
        email: "accounts@example.com",
      });

      const [, payload] = mockRequest.mock.calls[0];
      expect(payload.SearchParameters).not.toHaveProperty("Email");
      expect(payload.SearchParameters).toHaveProperty(
        "ContactEmail",
        "accounts@example.com",
      );
    });
  });
});
