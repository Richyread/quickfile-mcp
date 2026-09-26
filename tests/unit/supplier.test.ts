/**
 * Unit tests for supplier tools.
 */

import {
  handleSupplierTool,
  supplierTools,
  toCountryIso,
} from "../../src/tools/supplier";
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

  describe("quickfile_supplier_create", () => {
    it("sends SupplierDetails with QuickFile's supplier field names", async () => {
      mockRequest.mockResolvedValueOnce({ SupplierID: 5566009 });

      const result = await handleSupplierTool("quickfile_supplier_create", {
        companyName: "PlumbNation",
        email: "orders@send.plumbnation.co.uk",
        website: "https://www.plumbnation.co.uk",
        firstName: "Sam",
        lastName: "Jones",
        telephone: "01234 567890",
        address1: "1 High Street",
        address2: "Unit 4",
        address3: "Industrial Estate",
        town: "Birmingham",
        postcode: "B1 1AA",
        vatNumber: "GB123456789",
        companyRegNo: "01234567",
        currency: "GBP",
        termDays: 14,
      });

      expect(mockRequest).toHaveBeenCalledWith("Supplier_Create", {
        SupplierDetails: {
          CompanyName: "PlumbNation",
          CompanyNumber: "01234567",
          AddressLine1: "1 High Street",
          AddressLine2: "Unit 4",
          AddressLine3: "Industrial Estate",
          Town: "Birmingham",
          Postcode: "B1 1AA",
          CountryISO: "GB",
          VatNumber: "GB123456789",
          Website: "https://www.plumbnation.co.uk",
          ContactFirstName: "Sam",
          ContactSurname: "Jones",
          ContactEmail: "orders@send.plumbnation.co.uk",
          ContactTel: "01234 567890",
          Preferences: { DefaultCurrency: "GBP", DefaultTerm: 14 },
        },
      });
      expect(result.isError).toBeFalsy();
      expect(JSON.parse(result.content[0].text as string)).toMatchObject({
        success: true,
        supplierId: 5566009,
      });
    });

    it("sends only the name, email and default country for a minimal create", async () => {
      mockRequest.mockResolvedValueOnce({ SupplierID: 1 });

      await handleSupplierTool("quickfile_supplier_create", {
        companyName: "Acme",
        email: "billing@acme.test",
      });

      expect(mockRequest).toHaveBeenCalledWith("Supplier_Create", {
        SupplierDetails: {
          CompanyName: "Acme",
          CountryISO: "GB",
          ContactEmail: "billing@acme.test",
        },
      });
    });

    it("never sends the client-shaped fields the supplier schema rejects", async () => {
      mockRequest.mockResolvedValueOnce({ SupplierID: 1 });

      await handleSupplierTool("quickfile_supplier_create", {
        companyName: "Acme",
        email: "billing@acme.test",
        notes: "not a supplier field",
        title: "Mr",
        mobile: "07000 000000",
        county: "Shropshire",
      });

      const body = mockRequest.mock.calls[0][1];
      expect(body).not.toHaveProperty("SupplierData");
      for (const key of [
        "Email",
        "Notes",
        "Title",
        "Mobile",
        "Address",
        "Currency",
        "TermDays",
      ]) {
        expect(body.SupplierDetails).not.toHaveProperty(key);
      }
    });

    it("requires a company name without calling the API", async () => {
      const result = await handleSupplierTool("quickfile_supplier_create", {
        email: "billing@acme.test",
      });

      expect(result.isError).toBe(true);
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it("rejects a country that is not an ISO code without calling the API", async () => {
      const result = await handleSupplierTool("quickfile_supplier_create", {
        companyName: "Acme",
        country: "England",
      });

      expect(result.isError).toBe(true);
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it("advertises only fields the supplier record supports", () => {
      const tool = supplierTools.find(
        (t) => t.name === "quickfile_supplier_create",
      );
      const props = Object.keys(
        (tool?.inputSchema.properties ?? {}) as Record<string, unknown>,
      );

      expect(tool?.inputSchema.required).toEqual(["companyName"]);
      for (const unsupported of ["notes", "title", "mobile", "county"]) {
        expect(props).not.toContain(unsupported);
      }
    });
  });

  describe("toCountryIso", () => {
    it.each([
      [undefined, "GB"],
      ["", "GB"],
      ["gb", "GB"],
      ["UK", "GB"],
      ["United Kingdom", "GB"],
      ["ie", "IE"],
    ])("maps %p to %p", (input, expected) => {
      expect(toCountryIso(input)).toBe(expected);
    });

    it("throws on a country name it cannot map", () => {
      expect(() => toCountryIso("Ireland")).toThrow(/two-letter ISO code/);
    });
  });
});
