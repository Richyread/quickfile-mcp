/**
 * Unit tests for supplier tools.
 *
 * The assertions in this file pin the QuickFile supplier wire shape verified
 * live against the API on 2026-05-14. The full wire-format anchor lives in
 * src/tools/utils.ts next to the build helpers — if either Supplier_Create or
 * Supplier_Update appears to be misbehaving against the live API, re-read it
 * before changing the assertions below. Highlights:
 *
 *   - Wrapper: <SupplierDetails> for both Create and Update (NOT SupplierData).
 *   - Address: flat AddressLine1/2/3 + Town + Postcode + CountryISO on the
 *     root of SupplierDetails (NOT a nested <Address> block).
 *   - Preferences: <Preferences> nests DefaultCurrency / DefaultTerm /
 *     DefaultVatRate / DefaultNominalCode (NOT flat at the root).
 *   - Surname: Supplier_Create uses ContactSurname (lowercase n);
 *     Supplier_Update uses ContactSurName (capital N). The casing genuinely
 *     differs between the two endpoints.
 *   - No fields: Title, Mobile, ContactMobile, Notes, County, CompanyRegNo —
 *     these are accepted by the Client_* endpoints but rejected by the
 *     Supplier_* endpoints with HTTP 400.
 *   - Search: Supplier_Search uses ContactEmail (NOT Email); contact name
 *     filters split into ContactFirstName + ContactSurname (NOT ContactName).
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

  describe("quickfile_supplier_create", () => {
    it("declares companyName as a required input", () => {
      const tool = supplierTools.find(
        (candidate) => candidate.name === "quickfile_supplier_create",
      );

      expect(tool?.inputSchema).toMatchObject({
        required: ["companyName"],
      });
    });

    it("does not expose the supplier-rejected args (title, mobile, notes, county, companyRegNo)", () => {
      const tool = supplierTools.find(
        (candidate) => candidate.name === "quickfile_supplier_create",
      );
      const props = (tool?.inputSchema as { properties: Record<string, unknown> })
        .properties;

      expect(props).not.toHaveProperty("title");
      expect(props).not.toHaveProperty("mobile");
      expect(props).not.toHaveProperty("notes");
      expect(props).not.toHaveProperty("county");
      expect(props).not.toHaveProperty("companyRegNo");
    });

    it("wraps the payload in SupplierDetails (not SupplierData)", async () => {
      mockRequest.mockResolvedValueOnce({ SupplierID: 12345 });

      await handleSupplierTool("quickfile_supplier_create", {
        companyName: "Acme Widgets Ltd",
        countryIso: "GB",
      });

      const [methodName, payload] = mockRequest.mock.calls[0];
      expect(methodName).toBe("Supplier_Create");
      expect(payload).toHaveProperty("SupplierDetails");
      expect(payload).not.toHaveProperty("SupplierData");
    });

    it("emits Contact-prefixed contact fields with ContactSurname (lowercase n) and ContactTel", async () => {
      mockRequest.mockResolvedValueOnce({ SupplierID: 12345 });

      await handleSupplierTool("quickfile_supplier_create", {
        companyName: "Acme Widgets Ltd",
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        telephone: "020 7946 0000",
      });

      const [, payload] = mockRequest.mock.calls[0];
      expect(payload.SupplierDetails).toMatchObject({
        ContactFirstName: "Ada",
        ContactSurname: "Lovelace",
        ContactEmail: "ada@example.com",
        ContactTel: "020 7946 0000",
      });
      // Supplier_Create uses lowercase-n Surname; CAPITAL N would be Update.
      expect(payload.SupplierDetails).not.toHaveProperty("ContactSurName");
      // Client-style bare names are rejected by Supplier_Create.
      expect(payload.SupplierDetails).not.toHaveProperty("Email");
      expect(payload.SupplierDetails).not.toHaveProperty("FirstName");
      expect(payload.SupplierDetails).not.toHaveProperty("LastName");
      expect(payload.SupplierDetails).not.toHaveProperty("Telephone");
      // Supplier_Create has no mobile field at all.
      expect(payload.SupplierDetails).not.toHaveProperty("Mobile");
      expect(payload.SupplierDetails).not.toHaveProperty("ContactMobile");
    });

    it("emits flat AddressLine1/2/3 + Town + Postcode + CountryISO (no nested Address block)", async () => {
      mockRequest.mockResolvedValueOnce({ SupplierID: 12345 });

      await handleSupplierTool("quickfile_supplier_create", {
        companyName: "Acme Widgets Ltd",
        address1: "1 Example Street",
        address2: "Industrial Estate",
        address3: "Greater Trading Park",
        town: "Market Drayton",
        postcode: "TF9 4LA",
        countryIso: "GB",
      });

      const [, payload] = mockRequest.mock.calls[0];
      expect(payload.SupplierDetails).toMatchObject({
        AddressLine1: "1 Example Street",
        AddressLine2: "Industrial Estate",
        AddressLine3: "Greater Trading Park",
        Town: "Market Drayton",
        Postcode: "TF9 4LA",
        CountryISO: "GB",
      });
      expect(payload.SupplierDetails).not.toHaveProperty("Address");
      expect(payload.SupplierDetails).not.toHaveProperty("County");
    });

    it("accepts a 2-letter alpha-2 `country` arg as CountryISO for legacy callers", async () => {
      mockRequest.mockResolvedValueOnce({ SupplierID: 12345 });

      await handleSupplierTool("quickfile_supplier_create", {
        companyName: "Acme Widgets Ltd",
        country: "gb",
      });

      const [, payload] = mockRequest.mock.calls[0];
      expect(payload.SupplierDetails.CountryISO).toBe("GB");
    });

    it("drops non-ISO `country` values rather than sending data the API will reject", async () => {
      mockRequest.mockResolvedValueOnce({ SupplierID: 12345 });

      await handleSupplierTool("quickfile_supplier_create", {
        companyName: "Acme Widgets Ltd",
        country: "United Kingdom",
      });

      const [, payload] = mockRequest.mock.calls[0];
      expect(payload.SupplierDetails).not.toHaveProperty("CountryISO");
    });

    it("normalizes `countryIso` to uppercase before sending", async () => {
      mockRequest.mockResolvedValueOnce({ SupplierID: 12345 });

      await handleSupplierTool("quickfile_supplier_create", {
        companyName: "Acme Widgets Ltd",
        countryIso: "gb",
      });

      const [, payload] = mockRequest.mock.calls[0];
      expect(payload.SupplierDetails.CountryISO).toBe("GB");
    });

    it("drops non-ISO `countryIso` values just like the `country` path", async () => {
      mockRequest.mockResolvedValueOnce({ SupplierID: 12345 });

      await handleSupplierTool("quickfile_supplier_create", {
        companyName: "Acme Widgets Ltd",
        countryIso: "United Kingdom",
      });

      const [, payload] = mockRequest.mock.calls[0];
      expect(payload.SupplierDetails).not.toHaveProperty("CountryISO");
    });

    it("prefers `countryIso` over `country` when both are supplied", async () => {
      mockRequest.mockResolvedValueOnce({ SupplierID: 12345 });

      await handleSupplierTool("quickfile_supplier_create", {
        companyName: "Acme Widgets Ltd",
        countryIso: "US",
        country: "GB",
      });

      const [, payload] = mockRequest.mock.calls[0];
      expect(payload.SupplierDetails.CountryISO).toBe("US");
    });

    it("nests currency / termDays / VAT rate / nominal code inside a Preferences block", async () => {
      mockRequest.mockResolvedValueOnce({ SupplierID: 12345 });

      await handleSupplierTool("quickfile_supplier_create", {
        companyName: "Acme Widgets Ltd",
        currency: "GBP",
        termDays: 14,
        defaultVatRate: 20,
        defaultNominalCode: 5000,
      });

      const [, payload] = mockRequest.mock.calls[0];
      expect(payload.SupplierDetails).toHaveProperty("Preferences", {
        DefaultCurrency: "GBP",
        DefaultTerm: 14,
        DefaultVatRate: 20,
        DefaultNominalCode: 5000,
      });
      // Top-level Currency / TermDays would be rejected by the API.
      expect(payload.SupplierDetails).not.toHaveProperty("Currency");
      expect(payload.SupplierDetails).not.toHaveProperty("TermDays");
    });

    it("defaults Preferences.DefaultCurrency to GBP and DefaultTerm to 30 when neither was supplied", async () => {
      mockRequest.mockResolvedValueOnce({ SupplierID: 12345 });

      await handleSupplierTool("quickfile_supplier_create", {
        companyName: "Acme Widgets Ltd",
      });

      const [, payload] = mockRequest.mock.calls[0];
      expect(payload.SupplierDetails.Preferences).toEqual({
        DefaultCurrency: "GBP",
        DefaultTerm: 30,
      });
    });

    it("passes companyNumber and supplierReference straight through", async () => {
      mockRequest.mockResolvedValueOnce({ SupplierID: 12345 });

      await handleSupplierTool("quickfile_supplier_create", {
        companyName: "Acme Widgets Ltd",
        companyNumber: "01234567",
        supplierReference: "ACME",
      });

      const [, payload] = mockRequest.mock.calls[0];
      expect(payload.SupplierDetails).toMatchObject({
        CompanyNumber: "01234567",
        SupplierReference: "ACME",
      });
      // CompanyRegNo was the client-side name; suppliers want CompanyNumber.
      expect(payload.SupplierDetails).not.toHaveProperty("CompanyRegNo");
    });

    it("returns the new SupplierID on success", async () => {
      mockRequest.mockResolvedValueOnce({ SupplierID: 9876 });

      const result = await handleSupplierTool("quickfile_supplier_create", {
        companyName: "Acme Widgets Ltd",
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toMatchObject({
        success: true,
        supplierId: 9876,
      });
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

    it("does not expose the supplier-rejected args on update either", () => {
      const tool = supplierTools.find(
        (candidate) => candidate.name === "quickfile_supplier_update",
      );
      const props = (tool?.inputSchema as { properties: Record<string, unknown> })
        .properties;

      expect(props).not.toHaveProperty("title");
      expect(props).not.toHaveProperty("mobile");
      expect(props).not.toHaveProperty("notes");
      expect(props).not.toHaveProperty("county");
      expect(props).not.toHaveProperty("companyRegNo");
    });

    it("wraps the payload in SupplierDetails (not SupplierData)", async () => {
      mockRequest.mockResolvedValueOnce({ SupplierDetailsUpdated: false });

      await handleSupplierTool("quickfile_supplier_update", {
        supplierId: 12345,
        email: "accounts@example.com",
      });

      const [methodName, payload] = mockRequest.mock.calls[0];
      expect(methodName).toBe("Supplier_Update");
      expect(payload).toHaveProperty("SupplierDetails");
      expect(payload).not.toHaveProperty("SupplierData");
    });

    it("emits Contact-prefixed contact fields with ContactSurName (CAPITAL N) and ContactTel", async () => {
      mockRequest.mockResolvedValueOnce({ SupplierDetailsUpdated: true });

      await handleSupplierTool("quickfile_supplier_update", {
        supplierId: 99,
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        telephone: "020 7946 0000",
      });

      const [, payload] = mockRequest.mock.calls[0];
      expect(payload.SupplierDetails).toMatchObject({
        SupplierID: 99,
        ContactFirstName: "Ada",
        ContactSurName: "Lovelace",
        ContactEmail: "ada@example.com",
        ContactTel: "020 7946 0000",
      });
      // Supplier_Update uses CAPITAL-N Surname; lowercase n is Create.
      expect(payload.SupplierDetails).not.toHaveProperty("ContactSurname");
      // Supplier_Update has no mobile field and rejects ContactTelephone.
      expect(payload.SupplierDetails).not.toHaveProperty("ContactMobile");
      expect(payload.SupplierDetails).not.toHaveProperty("ContactTelephone");
      // Client-style bare names are rejected too.
      expect(payload.SupplierDetails).not.toHaveProperty("Email");
      expect(payload.SupplierDetails).not.toHaveProperty("FirstName");
      expect(payload.SupplierDetails).not.toHaveProperty("LastName");
      expect(payload.SupplierDetails).not.toHaveProperty("Telephone");
      expect(payload.SupplierDetails).not.toHaveProperty("Mobile");
    });

    it("emits flat address fields on update (no nested Address block)", async () => {
      mockRequest.mockResolvedValueOnce({ SupplierDetailsUpdated: true });

      await handleSupplierTool("quickfile_supplier_update", {
        supplierId: 1,
        address1: "76 Church Road",
        town: "Market Drayton",
        postcode: "TF9 4LA",
        countryIso: "GB",
      });

      const [, payload] = mockRequest.mock.calls[0];
      expect(payload.SupplierDetails).toMatchObject({
        SupplierID: 1,
        AddressLine1: "76 Church Road",
        Town: "Market Drayton",
        Postcode: "TF9 4LA",
        CountryISO: "GB",
      });
      expect(payload.SupplierDetails).not.toHaveProperty("Address");
    });

    it("omits Preferences entirely when no preference-related arg was supplied", async () => {
      mockRequest.mockResolvedValueOnce({ SupplierDetailsUpdated: true });

      await handleSupplierTool("quickfile_supplier_update", {
        supplierId: 1,
        email: "x@example.com",
      });

      const [, payload] = mockRequest.mock.calls[0];
      expect(payload.SupplierDetails).not.toHaveProperty("Preferences");
    });

    it("acts as a true partial update — only supplied fields appear on the wire", async () => {
      mockRequest.mockResolvedValueOnce({ SupplierDetailsUpdated: false });

      await handleSupplierTool("quickfile_supplier_update", {
        supplierId: 42,
        email: "x@example.com",
      });

      const [, payload] = mockRequest.mock.calls[0];
      expect(
        Object.keys(payload.SupplierDetails).sort((a, b) =>
          a.localeCompare(b),
        ),
      ).toEqual(["ContactEmail", "SupplierID"]);
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
  });

  describe("quickfile_supplier_search", () => {
    it("sends the email filter as ContactEmail (not bare Email)", async () => {
      mockRequest.mockResolvedValueOnce({ RecordsetCount: 0, Record: [] });

      await handleSupplierTool("quickfile_supplier_search", {
        email: "accounts@example.com",
      });

      const [methodName, payload] = mockRequest.mock.calls[0];
      expect(methodName).toBe("Supplier_Search");
      expect(payload.SearchParameters).toMatchObject({
        ContactEmail: "accounts@example.com",
      });
      // Supplier_Search rejects bare Email — would silently return zero hits.
      expect(payload.SearchParameters).not.toHaveProperty("Email");
    });

    it("splits the contact name filter into ContactFirstName and ContactSurname", async () => {
      mockRequest.mockResolvedValueOnce({ RecordsetCount: 0, Record: [] });

      await handleSupplierTool("quickfile_supplier_search", {
        firstName: "Ada",
        lastName: "Lovelace",
      });

      const [, payload] = mockRequest.mock.calls[0];
      expect(payload.SearchParameters).toMatchObject({
        ContactFirstName: "Ada",
        ContactSurname: "Lovelace",
      });
      // ContactName was never a real wire field on either endpoint.
      expect(payload.SearchParameters).not.toHaveProperty("ContactName");
    });

    it("sends the telephone filter as ContactTel and surfaces it in the input schema", async () => {
      const tool = supplierTools.find(
        (candidate) => candidate.name === "quickfile_supplier_search",
      );
      const props = (tool?.inputSchema as { properties: Record<string, unknown> })
        .properties;
      expect(props).toHaveProperty("telephone");

      mockRequest.mockResolvedValueOnce({ RecordsetCount: 0, Record: [] });
      await handleSupplierTool("quickfile_supplier_search", {
        telephone: "020 7946 0000",
      });

      const [, payload] = mockRequest.mock.calls[0];
      expect(payload.SearchParameters).toMatchObject({
        ContactTel: "020 7946 0000",
      });
      expect(payload.SearchParameters).not.toHaveProperty("ContactTelephone");
    });

    it("sends the supplierReference filter on the wire and surfaces it in the input schema", async () => {
      const tool = supplierTools.find(
        (candidate) => candidate.name === "quickfile_supplier_search",
      );
      const props = (tool?.inputSchema as { properties: Record<string, unknown> })
        .properties;
      expect(props).toHaveProperty("supplierReference");

      mockRequest.mockResolvedValueOnce({ RecordsetCount: 0, Record: [] });
      await handleSupplierTool("quickfile_supplier_search", {
        supplierReference: "ACME-001",
      });

      const [, payload] = mockRequest.mock.calls[0];
      expect(payload.SearchParameters).toMatchObject({
        SupplierReference: "ACME-001",
      });
    });

    it("omits undefined fields from SearchParameters", async () => {
      mockRequest.mockResolvedValueOnce({ RecordsetCount: 0, Record: [] });

      await handleSupplierTool("quickfile_supplier_search", {
        companyName: "Acme",
      });

      const [, payload] = mockRequest.mock.calls[0];
      expect(
        Object.keys(payload.SearchParameters).sort((a, b) =>
          a.localeCompare(b),
        ),
      ).toEqual([
        "CompanyName",
        "Offset",
        "OrderDirection",
        "OrderResultsBy",
        "ReturnCount",
      ]);
    });
  });
});
